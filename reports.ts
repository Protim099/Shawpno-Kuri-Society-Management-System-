import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma";
import Decimal from "decimal.js";
import { D } from "../lib/finance";
import { dateStr, HttpError, todayUTC } from "../lib/http";
import { cashBalance } from "./ledger";
import { refreshInstallmentStatuses } from "./loans";

export interface Report {
  title: string;
  columns: { key: string; header: string }[];
  rows: Record<string, string | number>[];
  summary?: Record<string, string | number>;
}
interface Filters { from?: Date; to?: Date; memberId?: number }
const n = (v: any) => D(v?.toString() ?? 0);
const money = (v: any) => n(v).toFixed(2);
const range = (f: Filters) => (f.from || f.to ? { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } : undefined);

export const REPORT_TYPES = [
  "society-financial", "member-savings", "member-loans", "loan-repayments", "monthly-interest",
  "daily-transactions", "cash-balance", "outstanding-loans", "overdue-installments", "income-expense",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export async function buildReport(type: ReportType, f: Filters): Promise<Report> {
  switch (type) {
    case "member-savings": {
      const members = await prisma.member.findMany({ where: f.memberId ? { id: f.memberId } : {}, include: { savingsAccount: { include: { transactions: { where: { txDate: range(f) } } } } }, orderBy: { memberCode: "asc" } });
      const rows = members.map((m) => {
        const tx = m.savingsAccount?.transactions ?? [];
        const dep = tx.filter((t) => ["DEPOSIT", "MONTHLY_SAVINGS", "ADDITIONAL_SAVINGS"].includes(t.type)).reduce((a, t) => a.plus(n(t.amount)), D(0));
        const wd = tx.filter((t) => t.type === "WITHDRAWAL").reduce((a, t) => a.plus(n(t.amount)), D(0));
        return { memberCode: m.memberCode, name: m.fullName, deposits: money(dep), withdrawals: money(wd), balance: money(m.savingsAccount?.balance) };
      });
      return { title: "Member Savings Report", columns: cols("memberCode:Member ID,name:Name,deposits:Deposits (৳),withdrawals:Withdrawals (৳),balance:Balance (৳)"), rows,
        summary: { totalBalance: money(rows.reduce((a, r) => a.plus(r.balance), D(0))) } };
    }
    case "member-loans": {
      const loans = await prisma.loan.findMany({ where: { ...(f.memberId && { memberId: f.memberId }), applicationDate: range(f) }, include: { member: true }, orderBy: { id: "asc" } });
      return { title: "Member Loan Report", columns: cols("loanCode:Loan ID,member:Member,principal:Principal,rate:Rate %,months:Months,totalPayable:Total Payable,status:Status"),
        rows: loans.map((l) => ({ loanCode: l.loanCode, member: `${l.member.memberCode} ${l.member.fullName}`, principal: money(l.principal), rate: l.interestRate.toString(), months: l.durationMonths, totalPayable: money(l.totalPayable), status: l.status })) };
    }
    case "loan-repayments": {
      const rp = await prisma.loanRepayment.findMany({ where: { paymentDate: range(f), reversed: false, ...(f.memberId && { loan: { memberId: f.memberId } }) }, include: { loan: { include: { member: true } } }, orderBy: { paymentDate: "asc" } });
      return { title: "Loan Repayment Report", columns: cols("date:Date,receipt:Receipt,loan:Loan,member:Member,principal:Principal,interest:Interest,advance:Advance,amount:Total"),
        rows: rp.map((r) => ({ date: dateStr(r.paymentDate), receipt: r.receiptNo, loan: r.loan.loanCode, member: r.loan.member.fullName, principal: money(r.principalPart), interest: money(r.interestPart), advance: money(r.advancePart), amount: money(r.amount) })),
        summary: { total: money(rp.reduce((a, r) => a.plus(n(r.amount)), D(0))) } };
    }
    case "monthly-interest": {
      const tx = await prisma.financialTransaction.findMany({ where: { type: { in: ["INTEREST_COLLECTION", "REVERSAL"] }, txDate: range(f), ...(f.memberId && { memberId: f.memberId }) }, include: { entries: true } });
      const m: Record<string, Decimal> = {};
      for (const t of tx) {
        const v = t.entries.filter((e) => e.account === "INTEREST_INCOME").reduce((a, e) => a.plus(n(e.credit)).minus(n(e.debit)), D(0));
        const k = t.txDate.toISOString().slice(0, 7);
        m[k] = (m[k] ?? D(0)).plus(v);
      }
      const rows = Object.entries(m).sort().map(([month, v]) => ({ month, interest: money(v) }));
      return { title: "Monthly Interest Collection Report", columns: cols("month:Month,interest:Interest Collected (৳)"), rows, summary: { total: money(Object.values(m).reduce((a, v) => a.plus(v), D(0))) } };
    }
    case "daily-transactions": {
      const tx = await prisma.financialTransaction.findMany({ where: { txDate: range(f), ...(f.memberId && { memberId: f.memberId }) }, include: { entries: true, member: true }, orderBy: [{ txDate: "asc" }, { id: "asc" }] });
      return { title: "Daily Transaction Report", columns: cols("date:Date,code:Tx ID,type:Type,member:Member,loan:Loan,debit:Debit,credit:Credit,description:Description"),
        rows: tx.map((t) => ({ date: dateStr(t.txDate), code: t.txCode, type: t.type, member: t.member?.memberCode ?? "", loan: t.loanId ?? "", debit: money(t.entries.reduce((a, e) => a.plus(n(e.debit)), D(0))), credit: money(t.entries.reduce((a, e) => a.plus(n(e.credit)), D(0))), description: t.description ?? "" })) };
    }
    case "cash-balance": {
      const e = await prisma.ledgerEntry.findMany({ where: { account: "CASH", transaction: { txDate: range(f) } }, include: { transaction: true }, orderBy: { id: "asc" } });
      let run = D(0);
      const rows = e.map((x) => { run = run.plus(n(x.debit)).minus(n(x.credit)); return { date: dateStr(x.transaction.txDate), code: x.transaction.txCode, type: x.transaction.type, in: money(x.debit), out: money(x.credit), balance: money(run) }; });
      const current = await prisma.$transaction((tx) => cashBalance(tx));
      return { title: "Cash Balance Report", columns: cols("date:Date,code:Tx ID,type:Type,in:Cash In,out:Cash Out,balance:Running Balance"), rows, summary: { availableCash: money(current) } };
    }
    case "outstanding-loans": {
      const loans = await prisma.loan.findMany({ where: { status: "ACTIVE", ...(f.memberId && { memberId: f.memberId }) }, include: { member: true } });
      return { title: "Outstanding Loan Report", columns: cols("loanCode:Loan ID,member:Member,principal:Principal,outPrincipal:Outstanding Principal,outInterest:Outstanding Interest,totalDue:Total Due"),
        rows: loans.map((l) => { const op = n(l.principal).minus(n(l.principalRecovered)); const oi = n(l.totalInterest).minus(n(l.interestCollected)); return { loanCode: l.loanCode, member: l.member.fullName, principal: money(l.principal), outPrincipal: money(op), outInterest: money(oi), totalDue: money(op.plus(oi)) }; }) };
    }
    case "overdue-installments": {
      await refreshInstallmentStatuses();
      const i = await prisma.loanInstallment.findMany({ where: { status: "OVERDUE", ...(f.memberId && { loan: { memberId: f.memberId } }) }, include: { loan: { include: { member: true } } }, orderBy: { dueDate: "asc" } });
      const today = todayUTC().getTime();
      return { title: "Overdue Installment Report", columns: cols("member:Member,loan:Loan,number:Inst #,dueDate:Due Date,days:Days Overdue,remaining:Remaining (৳)"),
        rows: i.map((x) => ({ member: `${x.loan.member.memberCode} ${x.loan.member.fullName}`, loan: x.loan.loanCode, number: x.number, dueDate: dateStr(x.dueDate), days: Math.floor((today - x.dueDate.getTime()) / 86400000), remaining: money(n(x.totalAmount).minus(n(x.paidAmount))) })) };
    }
    case "income-expense": {
      const tx = await prisma.financialTransaction.findMany({ where: { txDate: range(f) }, include: { entries: true } });
      const sum = (acc: string, sign: 1 | -1) => tx.reduce((a, t) => a.plus(t.entries.filter((e) => e.account === acc).reduce((s, e) => s.plus(n(e.credit)).minus(n(e.debit)), D(0)).mul(sign)), D(0));
      const interest = sum("INTEREST_INCOME", 1), other = sum("OTHER_INCOME", 1), exp = sum("EXPENSE", -1);
      return { title: "Income and Expense Report", columns: cols("item:Item,amount:Amount (৳)"),
        rows: [{ item: "Interest income", amount: money(interest) }, { item: "Other income", amount: money(other) }, { item: "Total income", amount: money(interest.plus(other)) }, { item: "Total expenses", amount: money(exp) }, { item: "Net surplus", amount: money(interest.plus(other).minus(exp)) }] };
    }
    case "society-financial": {
      const [cash, sav, loans, exp, other] = await Promise.all([
        prisma.$transaction((tx) => cashBalance(tx)),
        prisma.savingsAccount.aggregate({ _sum: { balance: true } }),
        prisma.loan.findMany({ where: { status: { in: ["ACTIVE", "CLOSED"] } } }),
        prisma.ledgerEntry.aggregate({ where: { account: "EXPENSE" }, _sum: { debit: true, credit: true } }),
        prisma.ledgerEntry.aggregate({ where: { account: "OTHER_INCOME" }, _sum: { debit: true, credit: true } }),
      ]);
      const disb = loans.reduce((a, l) => a.plus(n(l.principal)), D(0));
      const rec = loans.reduce((a, l) => a.plus(n(l.principalRecovered)), D(0));
      const ci = loans.reduce((a, l) => a.plus(n(l.totalInterest)), D(0));
      const ic = loans.reduce((a, l) => a.plus(n(l.interestCollected)), D(0));
      const rows = [
        ["Available cash", cash], ["Total member savings", n(sav._sum.balance)], ["Total loans disbursed", disb], ["Principal recovered", rec],
        ["Outstanding principal", disb.minus(rec)], ["Contractual interest", ci], ["Interest collected", ic], ["Outstanding interest", ci.minus(ic)],
        ["Other income", n(other._sum.credit).minus(n(other._sum.debit))], ["Total expenses", n(exp._sum.debit).minus(n(exp._sum.credit))],
      ].map(([item, v]) => ({ item: item as string, amount: money(v) }));
      return { title: "Complete Society Financial Report", columns: cols("item:Item,amount:Amount (৳)"), rows };
    }
    default:
      throw new HttpError(400, "Unknown report type");
  }
}

function cols(spec: string) {
  return spec.split(",").map((s) => { const [key, header] = s.split(":"); return { key, header }; });
}

export async function toExcel(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(r.title.slice(0, 30));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`Generated: ${dateStr(new Date())}`]);
  ws.addRow([]);
  const h = ws.addRow(r.columns.map((c) => c.header));
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2545" } };
  r.rows.forEach((row) => ws.addRow(r.columns.map((c) => row[c.key])));
  if (r.summary) { ws.addRow([]); Object.entries(r.summary).forEach(([k, v]) => ws.addRow([k, v]).font = { bold: true }); }
  ws.columns.forEach((c) => (c.width = 22));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: Report): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: r.columns.length > 5 ? "landscape" : "portrait" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(16).fillColor("#0B2545").text(r.title).fontSize(9).fillColor("#555").text(`Generated ${dateStr(new Date())}  |  Currency: BDT`).moveDown();
    const w = (doc.page.width - 72) / r.columns.length;
    const rowOut = (vals: any[], bold = false) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      doc.fontSize(8).font(bold ? "Helvetica-Bold" : "Helvetica").fillColor("#000");
      vals.forEach((v, i) => doc.text(String(v ?? ""), 36 + i * w, y, { width: w - 4, ellipsis: true, lineBreak: false }));
      doc.y = y + 14;
    };
    rowOut(r.columns.map((c) => c.header), true);
    r.rows.forEach((row) => rowOut(r.columns.map((c) => row[c.key])));
    if (r.summary) { doc.moveDown(); Object.entries(r.summary).forEach(([k, v]) => doc.font("Helvetica-Bold").text(`${k}: ${v}`)); }
    doc.end();
  });
}

export function toHtml(r: Report): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>body{font-family:Arial;margin:24px;color:#0B2545}table{border-collapse:collapse;width:100%}th{background:#0B2545;color:#fff}th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left}@media print{button{display:none}}</style></head><body><button onclick="print()">Print</button><h2>${esc(r.title)}</h2><p>Generated ${dateStr(new Date())} | BDT</p><table><tr>${r.columns.map((c) => `<th>${esc(c.header)}</th>`).join("")}</tr>${r.rows.map((row) => `<tr>${r.columns.map((c) => `<td>${esc(row[c.key])}</td>`).join("")}</tr>`).join("")}</table>${r.summary ? `<h4>${Object.entries(r.summary).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" | ")}</h4>` : ""}</body></html>`;
}
