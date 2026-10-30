/**
 * Demo seed - every record is flagged isDemo=true / labelled "(DEMO)".
 * All money movements go through the same services as the API, so the dashboard
 * and ledger reconcile exactly with the sample records.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { toDate, todayUTC } from "../src/lib/http";
import { postTransaction } from "../src/services/ledger";
import { recordSavings } from "../src/services/savings";
import { applyLoan, setLoanDecision, disburseLoan, recordRepayment, refreshInstallmentStatuses } from "../src/services/loans";
import { addExpense, addOtherIncome } from "../src/services/expenses";

const NAMES = ["Abdur Rahim", "Karim Uddin", "Nasima Begum", "Shafiqul Islam", "Rokeya Khatun", "Mizanur Rahman", "Salma Akter", "Jahangir Alam", "Farida Yasmin", "Abul Kashem",
  "Moriom Begum", "Delwar Hossain", "Sultana Razia", "Anwar Hossain", "Shirin Akter", "Habibur Rahman", "Rina Parvin", "Faruk Ahmed", "Taslima Nasrin", "Mostafa Kamal",
  "Hosne Ara", "Rafiqul Islam", "Jesmin Akter", "Nurul Amin", "Parul Begum"];
const GUARDIANS = ["Late Abdul Malek", "Md. Yunus Ali", "Abdul Hamid", "Md. Nazrul Islam", "Md. Ismail Hossain"];
const AREAS = ["Mirpur", "Uttara", "Savar", "Gazipur", "Narayanganj", "Tongi", "Keraniganj"];

const LOANS = [
  { m: 0, p: 50000, n: 6, d: "2026-01-05" }, { m: 2, p: 30000, n: 3, d: "2026-02-05" }, { m: 4, p: 80000, n: 12, d: "2026-01-15" },
  { m: 6, p: 25000, n: 4, d: "2026-03-05" }, { m: 8, p: 100000, n: 10, d: "2026-02-20" }, { m: 10, p: 60000, n: 6, d: "2026-04-05" },
  { m: 12, p: 40000, n: 8, d: "2026-05-05" }, { m: 14, p: 120000, n: 12, d: "2026-06-05" },
  { m: 16, p: 20000, n: 5, d: null }, // pending
  { m: 18, p: 45000, n: 6, d: null }, // approved, not yet disbursed
];

async function main() {
  console.log("Resetting database...");
  // delete children before parents (avoids relying on session-level FK toggles with pooled connections)
  await prisma.ledgerEntry.deleteMany();
  await prisma.financialTransaction.deleteMany();
  await prisma.loanRepayment.deleteMany();
  await prisma.loanInstallment.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.savingsTransaction.deleteMany();
  await prisma.savingsAccount.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.member.deleteMany();
  await prisma.user.deleteMany();
  await prisma.societySetting.deleteMany();

  const hash = (p: string) => bcrypt.hash(p, 12);
  const superAdmin = await prisma.user.create({ data: { name: "Super Admin (DEMO)", email: "superadmin@samiti.demo", passwordHash: await hash("Admin@12345"), role: "SUPER_ADMIN" } });
  await prisma.user.create({ data: { name: "Admin (DEMO)", email: "admin@samiti.demo", passwordHash: await hash("Admin@12345"), role: "ADMIN" } });
  await prisma.user.create({ data: { name: "Accountant (DEMO)", email: "accountant@samiti.demo", passwordHash: await hash("Account@12345"), role: "ACCOUNTANT" } });
  const uid = superAdmin.id;

  for (const [key, value] of Object.entries({
    DEFAULT_INTEREST_RATE: "2", SOCIETY_NAME: "Sonali Somobay Samiti (DEMO)", SOCIETY_ADDRESS: "Dhaka, Bangladesh", SOCIETY_PHONE: "01700000000", ALLOW_OVERDRAFT: "false",
  })) await prisma.societySetting.create({ data: { key, value } });

  await prisma.$transaction((tx) => postTransaction(tx, { type: "OPENING_BALANCE", amount: 1500000, date: toDate("2025-12-31"), description: "Opening cash (DEMO)", userId: uid, isDemo: true }));

  // 25 members
  const members = [];
  for (let i = 0; i < 25; i++) {
    const hasLogin = i === 0;
    let userId: number | undefined;
    if (hasLogin) userId = (await prisma.user.create({ data: { name: NAMES[i], email: "member1@samiti.demo", passwordHash: await hash("Member@12345"), role: "MEMBER" } })).id;
    members.push(await prisma.member.create({
      data: {
        memberCode: `M-${String(i + 1).padStart(4, "0")}`, userId, fullName: `${NAMES[i]} (DEMO)`, guardianName: GUARDIANS[i % GUARDIANS.length],
        mobile: `0171${String(1000000 + i * 7919).slice(0, 7)}`, address: `${AREAS[i % AREAS.length]}, Dhaka (DEMO)`,
        joiningDate: toDate(`2025-${String((i % 12) + 1).padStart(2, "0")}-10`), monthlySavingsTarget: [500, 1000, 1500, 2000, 3000][i % 5],
        savingsAccount: { create: {} }, isDemo: true,
      },
    }));
  }

  // Monthly savings Jan - Oct 2026
  for (let mo = 1; mo <= 10; mo++) {
    for (const [i, m] of members.entries()) {
      if (mo > 3 && i % 11 === 0 && mo % 2 === 0) continue; // a few members skip some months
      await recordSavings({ memberId: m.id, type: "MONTHLY_SAVINGS", amount: m.monthlySavingsTarget.toString(), date: toDate(`2026-${String(mo).padStart(2, "0")}-10`), note: "Monthly collection (DEMO)", userId: uid, isDemo: true });
    }
  }
  await recordSavings({ memberId: members[3].id, type: "ADDITIONAL_SAVINGS", amount: 5000, date: toDate("2026-06-20"), note: "Additional deposit (DEMO)", userId: uid, isDemo: true });
  await recordSavings({ memberId: members[5].id, type: "WITHDRAWAL", amount: 1000, date: toDate("2026-08-02"), note: "Withdrawal (DEMO)", userId: uid, isDemo: true });

  // Loans
  const today = todayUTC();
  const cutoff = new Date(today.getTime() - 5 * 86400000);
  for (const [idx, l] of LOANS.entries()) {
    const loan = await applyLoan({ memberId: members[l.m].id, principal: l.p, months: l.n, applicationDate: toDate(l.d ?? "2026-10-01"), userId: uid, isDemo: true });
    if (idx === 8) continue; // stays PENDING
    await setLoanDecision(loan.id, "APPROVED", uid);
    if (idx === 9) continue; // approved, awaiting disbursement
    await disburseLoan(loan.id, toDate(l.d!), undefined, uid);
    const insts = await prisma.loanInstallment.findMany({ where: { loanId: loan.id }, orderBy: { number: "asc" } });
    for (const inst of insts) {
      if (inst.dueDate > cutoff) break;
      if (idx === 2 && inst.number >= 6) break; // loan 3: left overdue
      if (idx === 4 && inst.number === 5) { // loan 5: partial payment
        await recordRepayment({ loanId: loan.id, installmentId: inst.id, amount: 6000, date: inst.dueDate, userId: uid, isDemo: true, note: "Partial payment (DEMO)" });
        break;
      }
      const extra = idx === 6 && inst.number === 2 ? 1500 : 0; // loan 7: overpayment flows to next installment
      await recordRepayment({ loanId: loan.id, installmentId: inst.id, amount: Number(inst.totalAmount) + extra, date: inst.dueDate, idempotencyKey: `seed-${loan.id}-${inst.number}`, userId: uid, isDemo: true });
    }
  }
  await refreshInstallmentStatuses();

  // Expenses and other income
  const exp = [["Office rent", 5000], ["Stationery", 1200], ["Meeting refreshments", 2500], ["Printing & receipts", 1800], ["Electricity", 900], ["Annual meeting", 8000], ["Registration fee", 3500], ["Transport", 1500], ["Internet", 1100], ["Audit fee", 4000], ["Maintenance", 2200], ["Miscellaneous", 700]] as const;
  for (const [i, [cat, amt]] of exp.entries()) await addExpense({ category: cat, amount: amt, date: toDate(`2026-${String((i % 10) + 1).padStart(2, "0")}-15`), description: "DEMO expense", userId: uid, isDemo: true });
  await addOtherIncome({ amount: 3000, date: toDate("2026-05-20"), description: "Membership/form fees (DEMO)", userId: uid, isDemo: true });

  console.log("Seed complete.\nLogins:\n  superadmin@samiti.demo / Admin@12345\n  admin@samiti.demo / Admin@12345\n  accountant@samiti.demo / Account@12345\n  member1@samiti.demo / Member@12345");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
