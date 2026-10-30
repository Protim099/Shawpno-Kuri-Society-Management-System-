import { jsPDF } from "jspdf";
import { api, money, fdate } from "./api";

/** Fetches receipt data from the API and downloads it as a PDF. */
export async function downloadReceipt(kind: "savings" | "repayment", id: number) {
  const r = await api(kind === "savings" ? `/savings/${id}/receipt` : `/loans/repayments/${id}/receipt`);
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  doc.setFillColor(11, 37, 69); doc.rect(0, 0, 148, 24, "F");
  doc.setTextColor(255); doc.setFontSize(15); doc.text(r.society?.name || "Samiti", 10, 12);
  doc.setFontSize(9); doc.text(`${kind === "savings" ? "Deposit" : "Payment"} Receipt`, 10, 19);
  doc.setTextColor(0); doc.setFontSize(10);
  const lines: [string, string][] = kind === "savings"
    ? [["Receipt No", r.receiptNo], ["Date", fdate(r.date)], ["Member", `${r.member.code} - ${r.member.name}`], ["Type", r.type], ["Amount", money(r.amount)], ["Balance after", money(r.balanceAfter)]]
    : [["Receipt No", r.receiptNo], ["Date", fdate(r.date)], ["Member", `${r.member.code} - ${r.member.name}`], ["Loan", r.loan], ["Total received", money(r.amount)], ["Interest part", money(r.interestPart)], ["Principal part", money(r.principalPart)], ["Advance", money(r.advancePart)]];
  lines.forEach(([k, v], i) => { doc.setFont("helvetica", "bold"); doc.text(k, 10, 36 + i * 9); doc.setFont("helvetica", "normal"); doc.text(String(v), 55, 36 + i * 9); });
  doc.setFontSize(8); doc.setTextColor(120); doc.text("Computer generated receipt. Currency: BDT.", 10, 140);
  doc.save(`${r.receiptNo}.pdf`);
}
