import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { D, round2, calculateLoan, generateSchedule, allocatePayment, installmentStatus } from "../lib/finance";
import { HttpError, receiptNo, todayUTC } from "../lib/http";
import { audit } from "../lib/audit";
import { postTransaction, reverseTransaction, getRate } from "./ledger";

type Tx = Prisma.TransactionClient;

export async function applyLoan(input: {
  memberId: number; principal: number | string; months: number; applicationDate: Date;
  ratePercent?: number | string; userId: number | null; isDemo?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({ where: { id: input.memberId } });
    if (!member) throw new HttpError(404, "Member not found");
    if (member.status !== "ACTIVE") throw new HttpError(422, "Only active members can apply for loans");
    const rate = input.ratePercent != null ? D(input.ratePercent) : await getRate(tx); // frozen on the loan
    let terms;
    try { terms = calculateLoan(input.principal, rate, input.months); } catch (e: any) { throw new HttpError(400, e.message); }
    const last = await tx.loan.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const loan = await tx.loan.create({
      data: {
        loanCode: `L-${String((last?.id ?? 0) + 1).padStart(4, "0")}`,
        memberId: member.id, principal: terms.principal.toString(), interestRate: rate.toString(),
        calcMethod: "FLAT_MONTHLY", durationMonths: terms.months,
        monthlyInterest: terms.monthlyInterest.toString(), totalInterest: terms.totalInterest.toString(),
        totalPayable: terms.totalPayable.toString(), monthlyInstallment: terms.monthlyInstallment.toString(),
        applicationDate: input.applicationDate, createdById: input.userId, isDemo: input.isDemo ?? false,
      },
    });
    await audit(input.userId, "LOAN_APPLY", "Loan", loan.id, { principal: terms.principal.toString() }, tx);
    return loan;
  });
}

export async function setLoanDecision(loanId: number, decision: "APPROVED" | "REJECTED", userId: number | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM loans WHERE id=${loanId} FOR UPDATE`;
    const loan = await tx.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new HttpError(404, "Loan not found");
    if (loan.status !== "PENDING") throw new HttpError(409, `Loan is already ${loan.status}`);
    const u = await tx.loan.update({ where: { id: loanId }, data: { status: decision, approvedAt: decision === "APPROVED" ? new Date() : null } });
    await audit(userId, "LOAN_" + decision, "Loan", loanId, undefined, tx);
    return u;
  });
}

export async function disburseLoan(loanId: number, disbursementDate: Date, firstInstallmentDate: Date | undefined, userId: number | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM loans WHERE id=${loanId} FOR UPDATE`;
    const loan = await tx.loan.findUnique({ where: { id: loanId }, include: { member: true } });
    if (!loan) throw new HttpError(404, "Loan not found");
    if (loan.status !== "APPROVED") throw new HttpError(422, "Only approved loans can be disbursed");
    const first = firstInstallmentDate ?? new Date(Date.UTC(disbursementDate.getUTCFullYear(), disbursementDate.getUTCMonth() + 1, disbursementDate.getUTCDate()));
    if (first < disbursementDate) throw new HttpError(400, "First installment date cannot be before disbursement date");
    const terms = calculateLoan(loan.principal.toString(), loan.interestRate.toString(), loan.durationMonths);
    const rows = generateSchedule(terms, first);
    const today = todayUTC();
    await tx.loanInstallment.createMany({
      data: rows.map((r) => ({
        loanId, number: r.number, dueDate: r.dueDate, principalAmount: r.principalAmount.toString(),
        interestAmount: r.interestAmount.toString(), totalAmount: r.totalAmount.toString(),
        status: installmentStatus(r.totalAmount, 0, r.dueDate, today),
      })),
    });
    await postTransaction(tx, {
      type: "LOAN_DISBURSEMENT", amount: loan.principal.toString(), date: disbursementDate, memberId: loan.memberId,
      loanId, reference: loan.loanCode, description: `Loan disbursement ${loan.loanCode} - ${loan.member.fullName}`,
      userId, isDemo: loan.isDemo,
    });
    const u = await tx.loan.update({ where: { id: loanId }, data: { status: "ACTIVE", disbursementDate, firstInstallmentDate: first } });
    await audit(userId, "LOAN_DISBURSE", "Loan", loanId, undefined, tx);
    return u;
  });
}

/** Marks statuses from due dates. Run before listing installments. */
export async function refreshInstallmentStatuses(tx: Tx | typeof prisma = prisma) {
  const today = todayUTC();
  await tx.loanInstallment.updateMany({ where: { status: { in: ["UPCOMING", "DUE", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, data: { status: "OVERDUE" } });
  await tx.loanInstallment.updateMany({ where: { status: "UPCOMING", dueDate: today }, data: { status: "DUE" } });
}

export async function recordRepayment(input: {
  loanId: number; amount: number | string; date: Date; installmentId?: number;
  idempotencyKey?: string; note?: string; userId: number | null; isDemo?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const dup = await tx.loanRepayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (dup) return { repayment: dup, duplicate: true };
    }
    await tx.$queryRaw`SELECT id FROM loans WHERE id=${input.loanId} FOR UPDATE`;
    const loan = await tx.loan.findUnique({ where: { id: input.loanId }, include: { member: true } });
    if (!loan) throw new HttpError(404, "Loan not found");
    if (loan.status !== "ACTIVE") throw new HttpError(422, "Repayments can only be recorded for active loans");
    const amount = round2(input.amount);
    if (amount.lte(0)) throw new HttpError(400, "Payment amount must be greater than zero");

    let insts = await tx.loanInstallment.findMany({ where: { loanId: loan.id, status: { not: "PAID" } }, orderBy: { number: "asc" } });
    if (input.installmentId) {
      const chosen = insts.find((i) => i.id === input.installmentId);
      if (!chosen) throw new HttpError(404, "Installment not found or already paid");
      insts = [chosen, ...insts.filter((i) => i.id !== chosen.id)];
    }
    let remaining = amount, totalP = D(0), totalI = D(0);
    const allocations: any[] = [];
    for (const inst of insts) {
      if (remaining.lte(0)) break;
      const a = allocatePayment(inst, remaining);
      const used = a.interestPaid.plus(a.principalPaid);
      if (used.lte(0)) continue;
      const paidP = D(inst.paidPrincipal.toString()).plus(a.principalPaid);
      const paidI = D(inst.paidInterest.toString()).plus(a.interestPaid);
      const paidTotal = paidP.plus(paidI);
      await tx.loanInstallment.update({
        where: { id: inst.id },
        data: {
          paidPrincipal: paidP.toString(), paidInterest: paidI.toString(), paidAmount: paidTotal.toString(),
          status: installmentStatus(inst.totalAmount.toString(), paidTotal, inst.dueDate, todayUTC()),
        },
      });
      allocations.push({ installmentId: inst.id, number: inst.number, principal: a.principalPaid.toString(), interest: a.interestPaid.toString() });
      totalP = totalP.plus(a.principalPaid); totalI = totalI.plus(a.interestPaid);
      remaining = remaining.minus(used);
    }
    const advance = remaining; // overpayment beyond the whole schedule is kept as an advance, never discarded
    const rn = receiptNo("RC");
    const repayment = await tx.loanRepayment.create({
      data: {
        receiptNo: rn, idempotencyKey: input.idempotencyKey, loanId: loan.id, installmentId: allocations[0]?.installmentId ?? null,
        amount: amount.toString(), principalPart: totalP.toString(), interestPart: totalI.toString(),
        advancePart: advance.toString(), paymentDate: input.date, note: input.note, createdById: input.userId, allocations,
      },
    });
    const desc = `Repayment ${loan.loanCode} - ${loan.member.fullName}`;
    const base = { date: input.date, memberId: loan.memberId, loanId: loan.id, reference: rn, description: desc, userId: input.userId, isDemo: input.isDemo };
    if (totalP.gt(0)) await postTransaction(tx, { ...base, type: "PRINCIPAL_REPAYMENT", amount: totalP });
    if (totalI.gt(0)) await postTransaction(tx, { ...base, type: "INTEREST_COLLECTION", amount: totalI });
    if (advance.gt(0)) await postTransaction(tx, { ...base, type: "ADVANCE_RECEIVED", amount: advance, description: desc + " (advance)" });

    const unpaid = await tx.loanInstallment.count({ where: { loanId: loan.id, status: { not: "PAID" } } });
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        principalRecovered: D(loan.principalRecovered.toString()).plus(totalP).toString(),
        interestCollected: D(loan.interestCollected.toString()).plus(totalI).toString(),
        advanceBalance: D(loan.advanceBalance.toString()).plus(advance).toString(),
        status: unpaid === 0 ? "CLOSED" : "ACTIVE",
      },
    });
    await audit(input.userId, "LOAN_REPAYMENT", "LoanRepayment", repayment.id, { amount: amount.toString(), advance: advance.toString() }, tx);
    return { repayment, duplicate: false };
  });
}

export async function reverseRepayment(repaymentId: number, userId: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const rp = await tx.loanRepayment.findUnique({ where: { id: repaymentId } });
    if (!rp) throw new HttpError(404, "Repayment not found");
    if (rp.reversed) throw new HttpError(409, "Repayment already reversed");
    await tx.$queryRaw`SELECT id FROM loans WHERE id=${rp.loanId} FOR UPDATE`;
    const loan = await tx.loan.findUniqueOrThrow({ where: { id: rp.loanId } });
    for (const a of (rp.allocations as any[]) ?? []) {
      const inst = await tx.loanInstallment.findUniqueOrThrow({ where: { id: a.installmentId } });
      const pp = D(inst.paidPrincipal.toString()).minus(a.principal);
      const pi = D(inst.paidInterest.toString()).minus(a.interest);
      await tx.loanInstallment.update({
        where: { id: inst.id },
        data: { paidPrincipal: pp.toString(), paidInterest: pi.toString(), paidAmount: pp.plus(pi).toString(), status: installmentStatus(inst.totalAmount.toString(), pp.plus(pi), inst.dueDate, todayUTC()) },
      });
    }
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        principalRecovered: D(loan.principalRecovered.toString()).minus(rp.principalPart.toString()).toString(),
        interestCollected: D(loan.interestCollected.toString()).minus(rp.interestPart.toString()).toString(),
        advanceBalance: D(loan.advanceBalance.toString()).minus(rp.advancePart.toString()).toString(),
        status: loan.status === "CLOSED" ? "ACTIVE" : loan.status,
      },
    });
    await tx.loanRepayment.update({ where: { id: rp.id }, data: { reversed: true } });
    const fins = await tx.financialTransaction.findMany({ where: { reference: rp.receiptNo, type: { not: "REVERSAL" } } });
    for (const f of fins) await reverseTransaction(tx, f.id, userId, reason);
    await audit(userId, "REPAYMENT_REVERSAL", "LoanRepayment", rp.id, { reason }, tx);
    return { ok: true };
  });
}

export async function closeLoan(loanId: number, userId: number) {
  return prisma.$transaction(async (tx) => {
    const unpaid = await tx.loanInstallment.count({ where: { loanId, status: { not: "PAID" } } });
    if (unpaid > 0) throw new HttpError(422, "Loan still has unpaid installments");
    const u = await tx.loan.update({ where: { id: loanId }, data: { status: "CLOSED" } });
    await audit(userId, "LOAN_CLOSE", "Loan", loanId, undefined, tx);
    return u;
  });
}
