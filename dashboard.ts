import { prisma } from "../lib/prisma";
import { D } from "../lib/finance";
import { cashBalance } from "./ledger";
import { refreshInstallmentStatuses } from "./loans";

const n = (v: any) => D(v?.toString() ?? 0);
const ym = (d: Date) => d.toISOString().slice(0, 7);

/** Every figure comes from DB rows (ledger, loans, savings) - nothing is hardcoded. */
export async function getDashboard() {
  await refreshInstallmentStatuses();
  const [members, savingsAgg, loans, cash, expensesAgg, otherIncomeAgg, interestIncomeAgg, repayPrincipalAgg] = await Promise.all([
    prisma.member.count(),
    prisma.savingsAccount.aggregate({ _sum: { balance: true } }),
    prisma.loan.findMany({ where: { status: { in: ["ACTIVE", "CLOSED"] } } }),
    prisma.$transaction((tx) => cashBalance(tx)),
    prisma.ledgerEntry.aggregate({ where: { account: "EXPENSE" }, _sum: { debit: true, credit: true } }),
    prisma.ledgerEntry.aggregate({ where: { account: "OTHER_INCOME" }, _sum: { debit: true, credit: true } }),
    prisma.ledgerEntry.aggregate({ where: { account: "INTEREST_INCOME" }, _sum: { debit: true, credit: true } }),
    prisma.ledgerEntry.aggregate({ where: { account: "LOANS_RECEIVABLE" }, _sum: { debit: true, credit: true } }),
  ]);
  const totalSavings = n(savingsAgg._sum.balance);
  const disbursed = loans.reduce((a, l) => a.plus(n(l.principal)), D(0));
  const recovered = loans.reduce((a, l) => a.plus(n(l.principalRecovered)), D(0));
  const contractualInterest = loans.reduce((a, l) => a.plus(n(l.totalInterest)), D(0));
  const interestCollected = loans.reduce((a, l) => a.plus(n(l.interestCollected)), D(0));
  const outstandingPrincipal = disbursed.minus(recovered);
  const expenses = n(expensesAgg._sum.debit).minus(n(expensesAgg._sum.credit));
  const kpis = {
    totalMembers: members,
    totalSavings: totalSavings.toString(),
    societyCapital: cash.plus(outstandingPrincipal).toString(), // cash + loans receivable
    totalDisbursed: disbursed.toString(),
    outstandingPrincipal: outstandingPrincipal.toString(),
    outstandingInterest: contractualInterest.minus(interestCollected).toString(),
    totalInterestCollected: interestCollected.toString(),
    totalRepaymentCollected: recovered.plus(interestCollected).toString(),
    availableCash: cash.toString(),
    totalExpenses: expenses.toString(),
    otherIncome: n(otherIncomeAgg._sum.credit).minus(n(otherIncomeAgg._sum.debit)).toString(),
    // reconciliation checks (should match the figures above)
    check: {
      loansReceivableLedger: n(repayPrincipalAgg._sum.debit).minus(n(repayPrincipalAgg._sum.credit)).toString(),
      interestIncomeLedger: n(interestIncomeAgg._sum.credit).minus(n(interestIncomeAgg._sum.debit)).toString(),
    },
  };

  const [savTx, finTx, installments] = await Promise.all([
    prisma.savingsTransaction.findMany({ select: { type: true, amount: true, txDate: true } }),
    prisma.financialTransaction.findMany({ where: { type: { in: ["INTEREST_COLLECTION", "PRINCIPAL_REPAYMENT", "EXPENSE", "OTHER_INCOME", "REVERSAL"] } }, include: { entries: true } }),
    prisma.loanInstallment.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const savingsByMonth: Record<string, { month: string; deposits: number; withdrawals: number }> = {};
  for (const t of savTx) {
    const k = ym(t.txDate);
    savingsByMonth[k] ??= { month: k, deposits: 0, withdrawals: 0 };
    const v = n(t.amount).toNumber();
    if (t.type === "WITHDRAWAL") savingsByMonth[k].withdrawals += v;
    else if (t.type !== "REVERSAL") savingsByMonth[k].deposits += v;
  }
  const interestByMonth: Record<string, number> = {};
  const incExp: Record<string, { month: string; income: number; expenses: number }> = {};
  for (const t of finTx) {
    const k = ym(t.txDate);
    incExp[k] ??= { month: k, income: 0, expenses: 0 };
    // net effect via ledger lines so reversals cancel correctly
    const net = (acc: string) => t.entries.filter((e) => e.account === acc).reduce((a, e) => a.plus(n(e.credit)).minus(n(e.debit)), D(0)).toNumber();
    const inc = net("INTEREST_INCOME") + net("OTHER_INCOME");
    const exp = -net("EXPENSE");
    incExp[k].income += inc;
    incExp[k].expenses += exp;
    interestByMonth[k] = (interestByMonth[k] ?? 0) + net("INTEREST_INCOME");
  }
  const byDuration: Record<string, number> = {};
  for (const l of loans) byDuration[`${l.durationMonths} months`] = (byDuration[`${l.durationMonths} months`] ?? 0) + n(l.principal).toNumber();

  const sorted = <T extends { month: string }>(o: Record<string, T>) => Object.values(o).sort((a, b) => a.month.localeCompare(b.month));
  return {
    kpis,
    charts: {
      monthlySavings: sorted(savingsByMonth),
      loanDistribution: Object.entries(byDuration).map(([name, value]) => ({ name, value })),
      monthlyInterest: Object.entries(interestByMonth).sort().map(([month, amount]) => ({ month, amount })),
      incomeVsExpenses: sorted(incExp),
      repaymentStats: installments.map((i) => ({ status: i.status, count: i._count._all })),
    },
  };
}
