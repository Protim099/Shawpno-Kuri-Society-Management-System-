import { prisma } from "../lib/prisma";
import { round2 } from "../lib/finance";
import { HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { postTransaction, reverseTransaction } from "./ledger";

export async function addExpense(input: { category: string; amount: number | string; date: Date; description?: string; userId: number | null; isDemo?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const amount = round2(input.amount);
    const ft = await postTransaction(tx, {
      type: "EXPENSE", amount, date: input.date, description: `${input.category}: ${input.description ?? ""}`,
      userId: input.userId, isDemo: input.isDemo,
    });
    const e = await tx.expense.create({
      data: { category: input.category, amount: amount.toString(), expenseDate: input.date, description: input.description, txId: ft.id, createdById: input.userId, isDemo: input.isDemo ?? false },
    });
    await audit(input.userId, "EXPENSE_ADD", "Expense", e.id, { amount: amount.toString() }, tx);
    return e;
  });
}

export async function reverseExpense(id: number, userId: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id } });
    if (!e) throw new HttpError(404, "Expense not found");
    if (e.reversed) throw new HttpError(409, "Expense already reversed");
    if (e.txId) await reverseTransaction(tx, e.txId, userId, reason);
    await tx.expense.update({ where: { id }, data: { reversed: true } });
    await audit(userId, "EXPENSE_REVERSAL", "Expense", id, { reason }, tx);
    return { ok: true };
  });
}

export async function addOtherIncome(input: { amount: number | string; date: Date; description?: string; userId: number | null; isDemo?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const ft = await postTransaction(tx, { type: "OTHER_INCOME", amount: input.amount, date: input.date, description: input.description ?? "Other income", userId: input.userId, isDemo: input.isDemo });
    await audit(input.userId, "OTHER_INCOME_ADD", "FinancialTransaction", ft.id, undefined, tx);
    return ft;
  });
}
