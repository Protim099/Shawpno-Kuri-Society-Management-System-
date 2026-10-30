import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError, toDate } from "../lib/http";
import { authenticate, authorize, ADMINS, STAFF } from "../lib/auth";
import { audit } from "../lib/audit";
import { D } from "../lib/finance";
import { recordSavings, reverseSavings } from "../services/savings";

export const membersRouter = Router();
membersRouter.use(authenticate);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const memberBody = z.object({
  fullName: z.string().min(2).max(120),
  guardianName: z.string().max(120).optional(),
  mobile: z.string().regex(/^(\+?88)?01[3-9]\d{8}$/, "Invalid Bangladeshi mobile number"),
  address: z.string().max(255).optional(),
  joiningDate: date,
  photoUrl: z.string().max(700_000).optional(),
  monthlySavingsTarget: z.coerce.number().min(0).default(0),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});

async function summary(memberId: number) {
  const [acc, loans] = await Promise.all([
    prisma.savingsAccount.findUnique({ where: { memberId } }),
    prisma.loan.findMany({ where: { memberId, status: { in: ["ACTIVE", "CLOSED"] } } }),
  ]);
  const outstanding = loans.filter((l) => l.status === "ACTIVE").reduce(
    (a, l) => a.plus(D(l.totalPayable.toString())).minus(l.principalRecovered.toString()).minus(l.interestCollected.toString()), D(0));
  return { totalSavings: acc?.balance.toString() ?? "0", totalLoans: loans.length, outstandingLoan: outstanding.toString() };
}

membersRouter.get("/", authorize(...STAFF), asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const members = await prisma.member.findMany({
    where: q ? { OR: [{ fullName: { contains: q } }, { memberCode: { contains: q } }, { mobile: { contains: q } }] } : {},
    include: { savingsAccount: true }, orderBy: { memberCode: "asc" },
  });
  const loans = await prisma.loan.findMany({ where: { status: "ACTIVE" } });
  res.json(members.map((m) => {
    const ml = loans.filter((l) => l.memberId === m.id);
    const out = ml.reduce((a, l) => a.plus(l.totalPayable.toString()).minus(l.principalRecovered.toString()).minus(l.interestCollected.toString()), D(0));
    return { ...m, photoUrl: undefined, hasPhoto: !!m.photoUrl, totalSavings: m.savingsAccount?.balance.toString() ?? "0", activeLoans: ml.length, outstandingLoan: out.toString() };
  }));
}));

membersRouter.post("/", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const b = memberBody.parse(req.body);
  const m = await prisma.$transaction(async (tx) => {
    const last = await tx.member.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    let userId: number | undefined;
    if (b.email && b.password) {
      userId = (await tx.user.create({ data: { name: b.fullName, email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(b.password, 12), role: "MEMBER" } })).id;
    }
    const member = await tx.member.create({
      data: {
        memberCode: `M-${String((last?.id ?? 0) + 1).padStart(4, "0")}`, userId, fullName: b.fullName, guardianName: b.guardianName,
        mobile: b.mobile, address: b.address, joiningDate: toDate(b.joiningDate), photoUrl: b.photoUrl,
        monthlySavingsTarget: b.monthlySavingsTarget, status: b.status,
        savingsAccount: { create: {} },
      },
    });
    await audit(req.user!.id, "MEMBER_CREATE", "Member", member.id, undefined, tx);
    return member;
  });
  res.status(201).json(m);
}));

// Member self-service (declared before /:id so "me" is not treated as an id)
membersRouter.get("/me/overview", authorize("MEMBER"), asyncHandler(async (req, res) => {
  if (!req.user!.memberId) throw new HttpError(404, "No member profile linked to this account");
  res.json(await profile(req.user!.memberId));
}));

async function profile(id: number) {
  const m = await prisma.member.findUnique({
    where: { id },
    include: {
      savingsAccount: { include: { transactions: { orderBy: [{ txDate: "desc" }, { id: "desc" }], take: 200 } } },
      loans: { include: { installments: { orderBy: { number: "asc" } }, repayments: { orderBy: { id: "desc" } } }, orderBy: { id: "desc" } },
    },
  });
  if (!m) throw new HttpError(404, "Member not found");
  return { ...m, summary: await summary(id) };
}

membersRouter.get("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  // members can only ever read their own record
  if (req.user!.role === "MEMBER" && req.user!.memberId !== id) throw new HttpError(403, "You can only view your own records");
  res.json(await profile(id));
}));

membersRouter.put("/:id", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = memberBody.partial().omit({ email: true, password: true }).parse(req.body);
  const m = await prisma.member.update({ where: { id }, data: { ...b, joiningDate: b.joiningDate ? toDate(b.joiningDate) : undefined } });
  await audit(req.user!.id, "MEMBER_UPDATE", "Member", id, b);
  res.json(m);
}));

// Members are never hard-deleted (financial history must remain). "Delete" = deactivate.
membersRouter.delete("/:id", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const active = await prisma.loan.count({ where: { memberId: id, status: { in: ["ACTIVE", "APPROVED", "PENDING"] } } });
  if (active) throw new HttpError(422, "Member has open loans and cannot be deactivated");
  await prisma.member.update({ where: { id }, data: { status: "INACTIVE" } });
  await audit(req.user!.id, "MEMBER_DEACTIVATE", "Member", id);
  res.json({ ok: true });
}));

// ---------- Savings ----------
export const savingsRouter = Router();
savingsRouter.use(authenticate);
savingsRouter.get("/", authorize(...STAFF), asyncHandler(async (req, res) => {
  const memberId = req.query.memberId ? Number(req.query.memberId) : undefined;
  const rows = await prisma.savingsTransaction.findMany({
    where: memberId ? { account: { memberId } } : {}, include: { account: { include: { member: { select: { memberCode: true, fullName: true } } } } },
    orderBy: [{ txDate: "desc" }, { id: "desc" }], take: 500,
  });
  res.json(rows);
}));
savingsRouter.get("/mine", authorize("MEMBER"), asyncHandler(async (req, res) => {
  res.json(await prisma.savingsTransaction.findMany({ where: { account: { memberId: req.user!.memberId ?? -1 } }, orderBy: [{ txDate: "desc" }, { id: "desc" }] }));
}));
savingsRouter.post("/", authorize(...STAFF), asyncHandler(async (req, res) => {
  const b = z.object({ memberId: z.number().int(), type: z.enum(["DEPOSIT", "MONTHLY_SAVINGS", "ADDITIONAL_SAVINGS", "WITHDRAWAL"]), amount: z.coerce.number().positive(), date, note: z.string().max(255).optional() }).parse(req.body);
  res.status(201).json(await recordSavings({ ...b, date: toDate(b.date), userId: req.user!.id }));
}));
savingsRouter.get("/:id/receipt", asyncHandler(async (req, res) => {
  const t = await prisma.savingsTransaction.findUnique({ where: { id: Number(req.params.id) }, include: { account: { include: { member: true } } } });
  if (!t) throw new HttpError(404, "Receipt not found");
  if (req.user!.role === "MEMBER" && req.user!.memberId !== t.account.memberId) throw new HttpError(403, "Not your receipt");
  res.json({ receiptNo: t.receiptNo, type: t.type, amount: t.amount, date: t.txDate, balanceAfter: t.balanceAfter, member: { code: t.account.member.memberCode, name: t.account.member.fullName } });
}));
savingsRouter.post("/:id/reverse", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
  res.json(await reverseSavings(Number(req.params.id), req.user!.id, reason));
}));
