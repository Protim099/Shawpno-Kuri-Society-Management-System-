import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const audit = (
  userId: number | null | undefined,
  action: string,
  entity: string,
  entityId?: string | number,
  details?: any,
  tx: Prisma.TransactionClient | typeof prisma = prisma
) =>
  tx.auditLog.create({
    data: { userId: userId ?? null, action, entity, entityId: entityId != null ? String(entityId) : null, details: details ?? undefined },
  });
