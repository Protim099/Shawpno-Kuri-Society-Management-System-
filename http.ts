import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", issues: err.issues });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.code === "P2002") return res.status(409).json({ error: "Duplicate record" });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

export const toDate = (s: string) => new Date(s + "T00:00:00.000Z");
export const todayUTC = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
export const dateStr = (d: Date) => d.toISOString().slice(0, 10);
export const receiptNo = (prefix: string) =>
  `${prefix}-${dateStr(new Date()).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
