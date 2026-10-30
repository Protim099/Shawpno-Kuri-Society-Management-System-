import { prisma } from "../lib/prisma";
import { D, round2 } from "../lib/finance";
import { HttpError, receiptNo } from "../lib/http";
import { audit } from "../lib/audit";
import { postTransaction, reverseTransaction } from "./ledger";

export type SavingsKind = "DEPOSIT" | "MONTHLY_SAVINGS" | "ADDITIONAL_SAVINGS" | "WITHDRAWAL";

export async function recordSavings(input: {
  memberId: number;
  type: SavingsKind;
  amount: number | string;
  date: Date;
  note?: string;
  userId: number | null;
  isDemo?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({ where: { id: input.memberId }, include: { savingsAccount: true } });
    if (!member || !member.savingsAccount) throw new HttpError(404, "Member not found");
    if (member.status !== "ACTIVE") throw new HttpError(422, "Member is not active");
    const amount = round2(input.amount);
    if (amount.lte(0)) throw new HttpError(400, "Amount must be greater than zero");
    const isW = input.type === "WITHDRAWAL";
    // lock the account row to serialize concurrent balance changes
    await tx.$queryRaw`SELECT id FROM savings_accounts WHERE id=${member.savingsAccount.id} FOR UPDATE`;
    const acc = await tx.savingsAccount.findUniqueOrThrow({ where: { id: member.savingsAccount.id } });
    const newBal = isW ? D(acc.balance.toString()).minus(amount) : D(acc.balance.toString()).plus(amount);
    if (newBal.lt(0)) throw new HttpError(422, "Withdrawal exceeds member savings balance");
    const rn = receiptNo("DR");
    await tx.savingsAccount.update({ where: { id: acc.id }, data: { balance: newBal.toString() } });
    const st = await tx.savingsTransaction.create({
      data: {
        receiptNo: rn, accountId: acc.id, type: input.type, amount: amount.toString(),
        balanceAfter: newBal.toString(), txDate: input.date, note: input.note, createdById: input.userId,
      },
    });
    await postTransaction(tx, {
      type: isW ? "MEMBER_WITHDRAWAL" : "MEMBER_DEPOSIT",
      amount, date: input.date, memberId: member.id, reference: rn,
      description: `${input.type} - ${member.fullName}`, userId: input.userId, isDemo: input.isDemo,
    });
    await audit(input.userId, "SAVINGS_" + input.type, "SavingsTransaction", st.id, { amount: amount.toString() }, tx);
    return st;
  });
}

export async function reverseSavings(savingsTxId: number, userId: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const st = await tx.savingsTransaction.findUnique({ where: { id: savingsTxId }, include: { account: true } });
    if (!st) throw new HttpError(404, "Savings transaction not found");
    if (st.type === "REVERSAL") throw new HttpError(400, "Cannot reverse a reversal");
    if (st.reversedById) throw new HttpError(409, "Already reversed");
    const wasWithdrawal = st.type === "WITHDRAWAL";
    await tx.$queryRaw`SELECT id FROM savings_accounts WHERE id=${st.accountId} FOR UPDATE`;
    const acc = await tx.savingsAccount.findUniqueOrThrow({ where: { id: st.accountId } });
    const amt = D(st.amount.toString());
    const newBal = wasWithdrawal ? D(acc.balance.toString()).plus(amt) : D(acc.balance.toString()).minus(amt);
    if (newBal.lt(0)) throw new HttpError(422, "Reversal would make savings balance negative");
    await tx.savingsAccount.update({ where: { id: acc.id }, data: { balance: newBal.toString() } });
    const rev = await tx.savingsTransaction.create({
      data: {
        receiptNo: receiptNo("RV"), accountId: acc.id, type: "REVERSAL", amount: amt.toString(),
        balanceAfter: newBal.toString(), txDate: new Date(), note: `Reversal of ${st.receiptNo}: ${reason}`, createdById: userId,
      },
    });
    await tx.savingsTransaction.update({ where: { id: st.id }, data: { reversedById: rev.id } });
    const fin = await tx.financialTransaction.findFirst({ where: { reference: st.receiptNo, type: { not: "REVERSAL" } } });
    if (fin) await reverseTransaction(tx, fin.id, userId, reason);
    await audit(userId, "SAVINGS_REVERSAL", "SavingsTransaction", st.id, { reason }, tx);
    return rev;
  });
}
