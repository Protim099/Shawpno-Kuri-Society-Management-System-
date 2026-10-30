import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "./http";
import { prisma } from "./prisma";

export type RoleName = "SUPER_ADMIN" | "ADMIN" | "ACCOUNTANT" | "MEMBER";
export interface AuthUser {
  id: number;
  role: RoleName;
  memberId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export const signToken = (u: { id: number; role: string }) =>
  jwt.sign({ id: u.id, role: u.role }, secret(), { expiresIn: (process.env.JWT_EXPIRES_IN || "8h") as any });

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new HttpError(401, "Authentication required");
    const payload = jwt.verify(h.slice(7), secret()) as { id: number };
    const user = await prisma.user.findUnique({ where: { id: payload.id }, include: { member: true } });
    if (!user || !user.isActive) throw new HttpError(401, "Account disabled or not found");
    req.user = { id: user.id, role: user.role as RoleName, memberId: user.member?.id ?? null };
    next();
  } catch (e: any) {
    next(e instanceof HttpError ? e : new HttpError(401, "Invalid or expired token"));
  }
}

export const authorize =
  (...roles: RoleName[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, "Insufficient permissions"));
    next();
  };

export const STAFF: RoleName[] = ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"];
export const ADMINS: RoleName[] = ["SUPER_ADMIN", "ADMIN"];
