import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError, toDate } from "../lib/http";
import { authenticate, authorize, ADMINS, STAFF } from "../lib/auth";
import { applyLoan, setLoanDecision, disburseLoan, recordRepayment, reverseRepayment, closeLoan, refreshInstallmentStatuses } from "../services/loans";
import { calculateLoan, generateSchedule } from "../lib/finance";
import { addExpense, reverseExpense, addOtherIncome } from "../services/expenses";
import { getDashboard } from "../services/dashboard";
import { buildReport, REPORT_TYPES, toExcel, toPdf, toHtml, ReportType } from "../services/reports";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const id = (v: string) => Number(v);

// ---------- Loans ----------
export const loansRouter = Router();
loansRouter.use(authenticate);

loansRouter.post("/calculate", authorize(...STAFF), asyncHandler(async (req, res) => {
  const b = z.object({ principal: z.coerce.number().positive(), ratePercent: z.coerce.number().min(0), months: z.coerce.number().int().min(1), firstDate: date.optional() }).parse(req.body);
  const t = calculateLoan(b.principal, b.ratePercent, b.months);
  const schedule = generateSchedule(t, toDate(b.firstDate ?? new Date().toISOString().slice(0, 10)));
  res.json({
    monthlyInterest: t.monthlyInterest, totalInterest: t.totalInterest, totalPayable: t.totalPayable, monthlyInstallment: t.monthlyInstallment,
    schedule: schedule.map((r) => ({ number: r.number, dueDate: r.dueDate, principal: r.principalAmount, interest: r.interestAmount, total: r.totalAmount })),
  });
}));

loansRouter.get("/", authorize(...STAFF), asyncHandler(async (req, res) => {
  const status = req.query.status as any;
  const loans = await prisma.loan.findMany({ where: status ? { status } : {}, include: { member: { select: { memberCode: true, fullName: true } } }, orderBy: { id: "desc" } });
  res.json(loans);
}));
loansRouter.get("/mine", authorize("MEMBER"), asyncHandler(async (req, res) => {
  res.json(await prisma.loan.findMany({ where: { memberId: req.user!.memberId ?? -1 }, include: { installments: { orderBy: { number: "asc" } }, repayments: true }, orderBy: { id: "desc" } }));
}));
loansRouter.get("/:id", asyncHandler(async (req, res) => {
  await refreshInstallmentStatuses();
  const loan = await prisma.loan.findUnique({ where: { id: id(req.params.id) }, include: { member: true, installments: { orderBy: { number: "asc" } }, repayments: { orderBy: { id: "desc" } } } });
  if (!loan) throw new HttpError(404, "Loan not found");
  if (req.user!.role === "MEMBER" && req.user!.memberId !== loan.memberId) throw new HttpError(403, "You can only view your own loans");
  const outP = Number(loan.principal) - Number(loan.principalRecovered);
  const outI = Number(loan.totalInterest) - Number(loan.interestCollected);
  res.json({ ...loan, member: { ...loan.member, photoUrl: undefined }, outstandingPrincipal: outP.toFixed(2), outstandingInterest: outI.toFixed(2) });
}));

loansRouter.post("/", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const b = z.object({ memberId: z.number().int(), principal: z.coerce.number().positive(), months: z.coerce.number().int().min(1).max(120), applicationDate: date, ratePercent: z.coerce.number().min(0).max(100).optional() }).parse(req.body);
  res.status(201).json(await applyLoan({ ...b, applicationDate: toDate(b.applicationDate), userId: req.user!.id }));
}));
loansRouter.post("/:id/approve", authorize(...ADMINS), asyncHandler(async (req, res) => res.json(await setLoanDecision(id(req.params.id), "APPROVED", req.user!.id))));
loansRouter.post("/:id/reject", authorize(...ADMINS), asyncHandler(async (req, res) => res.json(await setLoanDecision(id(req.params.id), "REJECTED", req.user!.id))));
loansRouter.post("/:id/disburse", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const b = z.object({ disbursementDate: date, firstInstallmentDate: date.optional() }).parse(req.body);
  res.json(await disburseLoan(id(req.params.id), toDate(b.disbursementDate), b.firstInstallmentDate ? toDate(b.firstInstallmentDate) : undefined, req.user!.id));
}));
loansRouter.post("/:id/close", authorize(...ADMINS), asyncHandler(async (req, res) => res.json(await closeLoan(id(req.params.id), req.user!.id))));
loansRouter.post("/:id/repayments", authorize(...STAFF), asyncHandler(async (req, res) => {
  const b = z.object({ amount: z.coerce.number().positive(), date, installmentId: z.number().int().optional(), idempotencyKey: z.string().max(80).optional(), note: z.string().max(255).optional() }).parse(req.body);
  const r = await recordRepayment({ loanId: id(req.params.id), ...b, date: toDate(b.date), userId: req.user!.id });
  res.status(r.duplicate ? 200 : 201).json(r);
}));
loansRouter.post("/repayments/:rid/reverse", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
  res.json(await reverseRepayment(id(req.params.rid), req.user!.id, reason));
}));
loansRouter.get("/repayments/:rid/receipt", asyncHandler(async (req, res) => {
  const r = await prisma.loanRepayment.findUnique({ where: { id: id(req.params.rid) }, include: { loan: { include: { member: true } } } });
  if (!r) throw new HttpError(404, "Receipt not found");
  if (req.user!.role === "MEMBER" && req.user!.memberId !== r.loan.memberId) throw new HttpError(403, "Not your receipt");
  const s = Object.fromEntries((await prisma.societySetting.findMany()).map((x) => [x.key, x.value]));
  res.json({ society: { name: s.SOCIETY_NAME, address: s.SOCIETY_ADDRESS, phone: s.SOCIETY_PHONE }, receiptNo: r.receiptNo, date: r.paymentDate, loan: r.loan.loanCode, member: { code: r.loan.member.memberCode, name: r.loan.member.fullName }, amount: r.amount, principalPart: r.principalPart, interestPart: r.interestPart, advancePart: r.advancePart, reversed: r.reversed });
}));

// ---------- Installments ----------
export const installmentsRouter = Router();
installmentsRouter.use(authenticate, authorize(...STAFF));
installmentsRouter.get("/", asyncHandler(async (req, res) => {
  await refreshInstallmentStatuses();
  const q = z.object({ status: z.enum(["UPCOMING", "DUE", "PARTIALLY_PAID", "PAID", "OVERDUE"]).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), search: z.string().optional(), today: z.enum(["1"]).optional() }).parse(req.query);
  const where: any = { loan: { status: { in: ["ACTIVE", "CLOSED"] } } };
  if (q.status) where.status = q.status;
  if (q.today) { const t = new Date(); where.dueDate = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); }
  if (q.month) { const [y, m] = q.month.split("-").map(Number); where.dueDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }; }
  if (q.search) where.loan.member = { OR: [{ memberCode: { contains: q.search } }, { fullName: { contains: q.search } }] };
  const rows = await prisma.loanInstallment.findMany({ where, include: { loan: { include: { member: { select: { memberCode: true, fullName: true } } } } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 1000 });
  res.json(rows.map((r) => ({ ...r, remaining: (Number(r.totalAmount) - Number(r.paidAmount)).toFixed(2) })));
}));

// ---------- Expenses & other income ----------
export const expensesRouter = Router();
expensesRouter.use(authenticate, authorize(...STAFF));
expensesRouter.get("/", asyncHandler(async (_req, res) => res.json(await prisma.expense.findMany({ orderBy: [{ expenseDate: "desc" }, { id: "desc" }], take: 500 }))));
expensesRouter.post("/", asyncHandler(async (req, res) => {
  const b = z.object({ category: z.string().min(2).max(60), amount: z.coerce.number().positive(), date, description: z.string().max(255).optional() }).parse(req.body);
  res.status(201).json(await addExpense({ ...b, date: toDate(b.date), userId: req.user!.id }));
}));
expensesRouter.post("/other-income", asyncHandler(async (req, res) => {
  const b = z.object({ amount: z.coerce.number().positive(), date, description: z.string().max(255).optional() }).parse(req.body);
  res.status(201).json(await addOtherIncome({ ...b, date: toDate(b.date), userId: req.user!.id }));
}));
expensesRouter.post("/:id/reverse", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
  res.json(await reverseExpense(id(req.params.id), req.user!.id, reason));
}));

// ---------- Ledger / transactions ----------
export const ledgerRouter = Router();
ledgerRouter.use(authenticate, authorize(...STAFF));
ledgerRouter.get("/", asyncHandler(async (req, res) => {
  const q = z.object({ type: z.string().optional(), from: date.optional(), to: date.optional(), memberId: z.coerce.number().optional() }).parse(req.query);
  const rows = await prisma.financialTransaction.findMany({
    where: { ...(q.type && { type: q.type as any }), ...(q.memberId && { memberId: q.memberId }), ...((q.from || q.to) && { txDate: { ...(q.from && { gte: toDate(q.from) }), ...(q.to && { lte: toDate(q.to) }) } }) },
    include: { entries: true, member: { select: { memberCode: true, fullName: true } } }, orderBy: [{ txDate: "desc" }, { id: "desc" }], take: 500,
  });
  res.json(rows);
}));
ledgerRouter.get("/trial-balance", asyncHandler(async (_req, res) => {
  const g = await prisma.ledgerEntry.groupBy({ by: ["account"], _sum: { debit: true, credit: true } });
  const rows = g.map((x) => ({ account: x.account, debit: x._sum.debit?.toString() ?? "0", credit: x._sum.credit?.toString() ?? "0" }));
  const td = rows.reduce((a, r) => a + Number(r.debit), 0), tc = rows.reduce((a, r) => a + Number(r.credit), 0);
  res.json({ rows, totalDebit: td.toFixed(2), totalCredit: tc.toFixed(2), balanced: Math.abs(td - tc) < 0.005 });
}));

// ---------- Dashboard ----------
export const dashboardRouter = Router();
dashboardRouter.get("/", authenticate, authorize(...STAFF), asyncHandler(async (_req, res) => res.json(await getDashboard())));

// ---------- Reports ----------
export const reportsRouter = Router();
reportsRouter.use(authenticate, authorize(...STAFF));
reportsRouter.get("/:type", asyncHandler(async (req, res) => {
  const type = req.params.type as ReportType;
  if (!REPORT_TYPES.includes(type)) throw new HttpError(404, "Unknown report");
  const q = z.object({ from: date.optional(), to: date.optional(), memberId: z.coerce.number().optional(), format: z.enum(["json", "pdf", "xlsx", "html"]).default("json") }).parse(req.query);
  const r = await buildReport(type, { from: q.from ? toDate(q.from) : undefined, to: q.to ? toDate(q.to) : undefined, memberId: q.memberId });
  if (q.format === "json") return res.json(r);
  if (q.format === "xlsx") { res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); res.setHeader("Content-Disposition", `attachment; filename="${type}.xlsx"`); return res.send(await toExcel(r)); }
  if (q.format === "pdf") { res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="${type}.pdf"`); return res.send(await toPdf(r)); }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(toHtml(r));
}));
