import { Prisma, FinTxType } from "@prisma/client";
import Decimal from "decimal.js";
import { D, round2 } from "../lib/finance";
import { HttpError, toDate } from "../lib/http";

export type Tx = Prisma.TransactionClient;

/** [debitAccount, creditAccount] for each transaction type (double-entry). */
const LINES: Partial<Record<FinTxType, [string, string]>> = {
  MEMBER_DEPOSIT: ["CASH", "MEMBER_SAVINGS"],
  MEMBER_WITHDRAWAL: ["MEMBER_SAVINGS", "CASH"],
  LOAN_DISBURSEMENT: ["LOANS_RECEIVABLE", "CASH"],
  PRINCIPAL_REPAYMENT: ["CASH", "LOANS_RECEIVABLE"],
  INTEREST_COLLECTION: ["CASH", "INTEREST_INCOME"],
  EXPENSE: ["EXPENSE", "CASH"],
  OTHER_INCOME: ["CASH", "OTHER_INCOME"],
  OPENING_BALANCE: ["CASH", "OPENING_CAPITAL"],
  ADVANCE_RECEIVED: ["CASH", "ADVANCE_LIABILITY"],
};

export async function cashBalance(tx: Tx): Promise<Decimal> {
  const a = await tx.ledgerEntry.aggregate({ where: { account: "CASH" }, _sum: { debit: true, credit: true } });
  return D(a._sum.debit?.toString() ?? 0).minus(a._sum.credit?.toString() ?? 0);
}

async function overdraftAllowed(tx: Tx) {
  const s = await tx.societySetting.findUnique({ where: { key: "ALLOW_OVERDRAFT" } });
  return s?.value === "true";
}

export interface PostInput {
  type: FinTxType;
  amount: Decimal.Value;
  date: Date;
  memberId?: number | null;
  loanId?: number | null;
  reference?: string | null;
  description?: string | null;
  userId?: number | null;
  isDemo?: boolean;
}

async function nextTxCode(tx: Tx) {
  const last = await tx.financialTransaction.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  return `TX-${String((last?.id ?? 0) + 1).padStart(7, "0")}`;
}

async function assertCashNotNegative(tx: Tx) {
  if ((await cashBalance(tx)).lt(0) && !(await overdraftAllowed(tx)))
    throw new HttpError(422, "Insufficient society cash balance for this operation");
}

/** Creates a financial transaction with balanced ledger lines. Must run inside a DB transaction. */
export async function postTransaction(tx: Tx, p: PostInput) {
  const amount = round2(p.amount);
  if (amount.lte(0)) throw new HttpError(400, "Amount must be greater than zero");
  const lines = LINES[p.type];
  if (!lines) throw new HttpError(400, `Unsupported transaction type ${p.type}`);
  const ft = await tx.financialTransaction.create({
    data: {
      txCode: await nextTxCode(tx),
      type: p.type,
      memberId: p.memberId ?? null,
      loanId: p.loanId ?? null,
      amount: amount.toString(),
      txDate: p.date,
      reference: p.reference ?? null,
      description: p.description ?? null,
      createdById: p.userId ?? null,
      isDemo: p.isDemo ?? false,
      entries: {
        create: [
          { account: lines[0], debit: amount.toString(), credit: "0" },
          { account: lines[1], debit: "0", credit: amount.toString() },
        ],
      },
    },
  });
  if (lines[1] === "CASH" || lines[0] === "CASH") await assertCashNotNegative(tx);
  return ft;
}

/** Reversal = new transaction with swapped lines; the original is never deleted or edited. */
export async function reverseTransaction(tx: Tx, txId: number, userId: number | null, reason: string, date = toDate(new Date().toISOString().slice(0, 10))) {
  const orig = await tx.financialTransaction.findUnique({ where: { id: txId }, include: { entries: true } });
  if (!orig) throw new HttpError(404, "Transaction not found");
  if (orig.type === "REVERSAL") throw new HttpError(400, "A reversal cannot be reversed");
  const existing = await tx.financialTransaction.findFirst({ where: { reversalOf: txId } });
  if (existing) throw new HttpError(409, "Transaction already reversed");
  const rev = await tx.financialTransaction.create({
    data: {
      txCode: await nextTxCode(tx),
      type: "REVERSAL",
      memberId: orig.memberId,
      loanId: orig.loanId,
      amount: orig.amount,
      txDate: date,
      reference: orig.txCode,
      description: `Reversal of ${orig.txCode}: ${reason}`,
      reversalOf: orig.id,
      createdById: userId,
      isDemo: orig.isDemo,
      entries: { create: orig.entries.map((e) => ({ account: e.account, debit: e.credit, credit: e.debit })) },
    },
  });
  await assertCashNotNegative(tx);
  return rev;
}

export async function getRate(tx: Tx): Promise<Decimal> {
  const s = await tx.societySetting.findUnique({ where: { key: "DEFAULT_INTEREST_RATE" } });
  return D(s?.value ?? 2);
}
