import { describe, it, expect } from "vitest";
import { calculateLoan, generateSchedule, allocatePayment, installmentStatus, D } from "../src/lib/finance";

describe("flat interest calculation", () => {
  it("matches the spec example (50,000 @ 2% x 6 months)", () => {
    const t = calculateLoan(50000, 2, 6);
    expect(t.monthlyInterest.toString()).toBe("1000");
    expect(t.totalInterest.toString()).toBe("6000");
    expect(t.totalPayable.toString()).toBe("56000");
    expect(t.monthlyInstallment.toString()).toBe("9333.33");
  });
  it("rejects invalid input", () => {
    expect(() => calculateLoan(0, 2, 6)).toThrow();
    expect(() => calculateLoan(1000, 2, 0)).toThrow();
    expect(() => calculateLoan(1000, -1, 3)).toThrow();
  });
});

describe("schedule generation", () => {
  it("installments sum exactly to total payable (rounding goes to last)", () => {
    const t = calculateLoan(50000, 2, 6);
    const s = generateSchedule(t, new Date(Date.UTC(2026, 0, 31)));
    expect(s).toHaveLength(6);
    const total = s.reduce((a, r) => a.plus(r.totalAmount), D(0));
    const prin = s.reduce((a, r) => a.plus(r.principalAmount), D(0));
    const intr = s.reduce((a, r) => a.plus(r.interestAmount), D(0));
    expect(total.toString()).toBe("56000");
    expect(prin.toString()).toBe("50000");
    expect(intr.toString()).toBe("6000");
  });
  it("handles awkward amounts without drift", () => {
    for (const [p, m] of [[10001, 7], [33333.33, 9], [99999.99, 11], [1, 3]] as const) {
      const t = calculateLoan(p, 2, m);
      const s = generateSchedule(t, new Date(Date.UTC(2026, 0, 15)));
      const total = s.reduce((a, r) => a.plus(r.totalAmount), D(0));
      expect(total.equals(t.totalPayable)).toBe(true);
    }
  });
  it("clamps month-end due dates", () => {
    const t = calculateLoan(3000, 2, 3);
    const s = generateSchedule(t, new Date(Date.UTC(2026, 0, 31)));
    expect(s[1].dueDate.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(s[2].dueDate.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
});

describe("payment allocation", () => {
  const inst = { principalAmount: 8333.33, interestAmount: 1000, paidPrincipal: 0, paidInterest: 0 };
  it("interest first, then principal", () => {
    const a = allocatePayment(inst, 5000);
    expect(a.interestPaid.toString()).toBe("1000");
    expect(a.principalPaid.toString()).toBe("4000");
    expect(a.advance.toString()).toBe("0");
  });
  it("partial payment below interest", () => {
    const a = allocatePayment(inst, 400);
    expect(a.interestPaid.toString()).toBe("400");
    expect(a.principalPaid.toString()).toBe("0");
  });
  it("overpayment is tracked as advance, never discarded", () => {
    const a = allocatePayment(inst, 10000);
    expect(a.interestPaid.plus(a.principalPaid).toString()).toBe("9333.33");
    expect(a.advance.toString()).toBe("666.67");
  });
  it("rejects non-positive payment", () => {
    expect(() => allocatePayment(inst, 0)).toThrow();
  });
});

describe("installment status", () => {
  const due = new Date(Date.UTC(2026, 5, 10));
  it("classifies correctly", () => {
    expect(installmentStatus(100, 100, due, new Date(Date.UTC(2026, 6, 1)))).toBe("PAID");
    expect(installmentStatus(100, 0, due, new Date(Date.UTC(2026, 6, 1)))).toBe("OVERDUE");
    expect(installmentStatus(100, 0, due, new Date(Date.UTC(2026, 5, 10)))).toBe("DUE");
    expect(installmentStatus(100, 0, due, new Date(Date.UTC(2026, 5, 1)))).toBe("UPCOMING");
    expect(installmentStatus(100, 40, due, new Date(Date.UTC(2026, 5, 1)))).toBe("PARTIALLY_PAID");
  });
});
