"use client";
import { Download } from "lucide-react";
import { money, fdate } from "@/lib/api";
import { downloadReceipt } from "@/lib/receipt";
import { Badge, Button, Card, StatCard, Table } from "@/components/ui";

/** Full financial profile of one member. Used by staff (/members/[id]) and the member's own panel (/my). */
export function MemberProfile({ p }: { p: any }) {
  const s = p.summary;
  const txs = p.savingsAccount?.transactions ?? [];
  const loans = p.loans ?? [];
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {p.photoUrl ? <img src={p.photoUrl} alt="" className="h-20 w-20 rounded-full object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-navy-100 text-2xl font-bold text-navy-800">{p.fullName?.[0]}</div>}
          <div className="grid flex-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div><b>{p.fullName}</b> <span className="font-mono text-xs text-slate-500">{p.memberCode}</span> <Badge v={p.status} /></div>
            <div>Father/Husband: {p.guardianName || "—"}</div><div>Mobile: {p.mobile}</div><div>Joined: {fdate(p.joiningDate)}</div>
            <div className="sm:col-span-2">Address: {p.address || "—"}</div><div>Monthly target: {money(p.monthlySavingsTarget)}</div>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total Savings / মোট সঞ্চয়" value={money(s.totalSavings)} tone="income" />
        <StatCard label="Total Loans / মোট ঋণ" value={String(s.totalLoans)} />
        <StatCard label="Outstanding Loan / বকেয়া ঋণ" value={money(s.outstandingLoan)} tone="expense" />
      </div>
      <Card title="Savings History / সঞ্চয়ের ইতিহাস">
        <Table head={["Date", "Receipt", "Type", "Amount", "Balance", ""]} empty={!txs.length}>
          {txs.map((t: any) => (
            <tr key={t.id}><td>{fdate(t.txDate)}</td><td className="font-mono text-xs">{t.receiptNo}</td><td>{t.type.replace("_", " ")}</td>
              <td className={t.type === "WITHDRAWAL" ? "text-expense" : "text-income"}>{money(t.amount)}</td><td>{money(t.balanceAfter)}</td>
              <td><Button size="sm" variant="ghost" onClick={() => downloadReceipt("savings", t.id)}><Download size={14} /></Button></td></tr>
          ))}
        </Table>
      </Card>
      {loans.map((l: any) => (
        <Card key={l.id} title={`${l.loanCode} - ${money(l.principal)} @ ${Number(l.interestRate)}% flat x ${l.durationMonths} months`} action={<Badge v={l.status} />}>
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-4">
            <div>Monthly interest: <b>{money(l.monthlyInterest)}</b></div><div>Total interest: <b>{money(l.totalInterest)}</b></div>
            <div>Total payable: <b>{money(l.totalPayable)}</b></div><div>Installment: <b>{money(l.monthlyInstallment)}</b></div>
          </div>
          {l.installments.length > 0 && (
            <Table head={["#", "Due", "Principal", "Interest", "Total", "Paid", "Remaining", "Status"]}>
              {l.installments.map((i: any) => (
                <tr key={i.id}><td>{i.number}</td><td>{fdate(i.dueDate)}</td><td>{money(i.principalAmount)}</td><td>{money(i.interestAmount)}</td><td>{money(i.totalAmount)}</td>
                  <td className="text-income">{money(i.paidAmount)}</td><td>{money(Number(i.totalAmount) - Number(i.paidAmount))}</td><td><Badge v={i.status} /></td></tr>
              ))}
            </Table>
          )}
          {l.repayments.length > 0 && (
            <div className="mt-4"><h4 className="mb-1 text-sm font-semibold text-navy-800">Repayments</h4>
              <Table head={["Date", "Receipt", "Amount", "Principal", "Interest", "Advance", ""]}>
                {l.repayments.map((r: any) => (
                  <tr key={r.id} className={r.reversed ? "line-through opacity-50" : ""}><td>{fdate(r.paymentDate)}</td><td className="font-mono text-xs">{r.receiptNo}</td><td>{money(r.amount)}</td><td>{money(r.principalPart)}</td><td>{money(r.interestPart)}</td><td>{money(r.advancePart)}</td>
                    <td><Button size="sm" variant="ghost" onClick={() => downloadReceipt("repayment", r.id)}><Download size={14} /></Button></td></tr>
                ))}
              </Table></div>
          )}
        </Card>
      ))}
    </div>
  );
}
