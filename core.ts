import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError, toDate, dateStr } from "../lib/http";
import { authenticate, authorize, signToken, ADMINS, STAFF } from "../lib/auth";
import { audit } from "../lib/audit";

export const authRouter = Router();
authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { member: true } });
  if (!u || !u.isActive || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, "Invalid email or password");
  await audit(u.id, "LOGIN", "User", u.id);
  res.json({ token: signToken(u), user: { id: u.id, name: u.name, email: u.email, role: u.role, memberId: u.member?.id ?? null } });
}));
authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { member: true } });
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, memberId: u.member?.id ?? null });
}));
authRouter.post("/change-password", authenticate, asyncHandler(async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new HttpError(400, "Current password is incorrect");
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  await audit(u.id, "PASSWORD_CHANGE", "User", u.id);
  res.json({ ok: true });
}));

// ---------- Users & roles ----------
export const usersRouter = Router();
usersRouter.use(authenticate, authorize(...ADMINS));
usersRouter.get("/", asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true }, orderBy: { id: "asc" } });
  res.json(users);
}));
usersRouter.post("/", asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), role: z.enum(["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "MEMBER"]) }).parse(req.body);
  if ((b.role === "SUPER_ADMIN" || b.role === "ADMIN") && req.user!.role !== "SUPER_ADMIN") throw new HttpError(403, "Only a Super Admin can create admin users");
  const u = await prisma.user.create({ data: { name: b.name, email: b.email.toLowerCase(), role: b.role, passwordHash: await bcrypt.hash(b.password, 12) } });
  await audit(req.user!.id, "USER_CREATE", "User", u.id, { role: b.role });
  res.status(201).json({ id: u.id });
}));
usersRouter.patch("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ role: z.enum(["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "MEMBER"]).optional(), isActive: z.boolean().optional(), password: z.string().min(8).optional() }).parse(req.body);
  if (req.user!.role !== "SUPER_ADMIN" && (b.role === "SUPER_ADMIN" || b.role === "ADMIN")) throw new HttpError(403, "Only a Super Admin can grant admin roles");
  if (id === req.user!.id && (b.isActive === false || (b.role && b.role !== req.user!.role))) throw new HttpError(400, "You cannot change your own role or disable yourself");
  await prisma.user.update({ where: { id }, data: { role: b.role, isActive: b.isActive, ...(b.password && { passwordHash: await bcrypt.hash(b.password, 12) }) } });
  await audit(req.user!.id, "USER_UPDATE", "User", id, { role: b.role, isActive: b.isActive });
  res.json({ ok: true });
}));

// ---------- Settings ----------
export const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.get("/", authorize(...STAFF), asyncHandler(async (_req, res) => {
  const rows = await prisma.societySetting.findMany();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));
settingsRouter.put("/", authorize(...ADMINS), asyncHandler(async (req, res) => {
  const b = z.object({
    DEFAULT_INTEREST_RATE: z.coerce.number().min(0).max(100).optional(),
    SOCIETY_NAME: z.string().max(120).optional(), SOCIETY_ADDRESS: z.string().max(200).optional(), SOCIETY_PHONE: z.string().max(30).optional(),
    ALLOW_OVERDRAFT: z.enum(["true", "false"]).optional(),
  }).parse(req.body);
  for (const [key, value] of Object.entries(b)) {
    if (value === undefined) continue;
    await prisma.societySetting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });
  }
  // interest rate change affects only future loans: existing loans keep their stored rate
  await audit(req.user!.id, "SETTINGS_UPDATE", "SocietySetting", undefined, b);
  res.json({ ok: true });
}));

// ---------- Audit log ----------
export const auditRouter = Router();
auditRouter.get("/", authenticate, authorize(...ADMINS), asyncHandler(async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 100, 500);
  res.json(await prisma.auditLog.findMany({ orderBy: { id: "desc" }, take, include: { user: { select: { name: true } } } }));
}));

export { toDate, dateStr };
