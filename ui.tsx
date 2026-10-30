"use client";
import React, { useEffect } from "react";
import { X } from "lucide-react";

export function Button({ variant = "primary", size = "md", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "success" | "ghost"; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-navy-800 text-white hover:bg-navy-700",
    outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    danger: "bg-expense text-white hover:bg-red-800",
    success: "bg-income text-white hover:bg-green-800",
    ghost: "text-navy-800 hover:bg-navy-50",
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm"} ${v} ${className}`} />;
}

export const Card = ({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
    {(title || action) && <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h3 className="font-semibold text-navy-800">{title}</h3>{action}</div>}
    <div className="p-5">{children}</div>
  </section>
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className = "", ...p }, ref) => (
  <input ref={ref} {...p} className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-1 focus:ring-navy-500 ${className}`} />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className = "", ...p }, ref) => (
  <select ref={ref} {...p} className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 ${className}`} />
));
Select.displayName = "Select";

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">{label}</span>{children}</label>
);

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print" onMouseDown={onClose}>
      <div className={`max-h-[90vh] w-full overflow-auto rounded-xl bg-white shadow-xl ${wide ? "max-w-3xl" : "max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3"><h3 className="font-semibold text-navy-800">{title}</h3><button onClick={onClose}><X size={18} /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Confirmation dialog for destructive or irreversible financial actions. */
export function Confirm({ open, title, message, onYes, onClose, danger }: { open: boolean; title: string; message: string; onYes: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-5 text-sm text-slate-600">{message}</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel / বাতিল</Button><Button variant={danger ? "danger" : "primary"} onClick={() => { onYes(); onClose(); }}>Confirm / নিশ্চিত</Button></div>
    </Modal>
  );
}

const BADGE: Record<string, string> = {
  PAID: "bg-green-100 text-green-800", CLOSED: "bg-green-100 text-green-800", ACTIVE: "bg-blue-100 text-blue-800", APPROVED: "bg-sky-100 text-sky-800",
  UPCOMING: "bg-slate-100 text-slate-700", DUE: "bg-amber-100 text-amber-800", PENDING: "bg-amber-100 text-amber-800",
  PARTIALLY_PAID: "bg-orange-100 text-orange-800", OVERDUE: "bg-red-100 text-red-800", REJECTED: "bg-red-100 text-red-800", INACTIVE: "bg-slate-200 text-slate-700", SUSPENDED: "bg-red-100 text-red-800",
};
export const Badge = ({ v }: { v: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[v] ?? "bg-slate-100 text-slate-700"}`}>{v.replace("_", " ")}</span>;

export const StatCard = ({ label, value, icon, tone = "navy" }: { label: string; value: string; icon?: React.ReactNode; tone?: "navy" | "income" | "expense" }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between text-xs font-medium text-slate-500"><span>{label}</span>{icon}</div>
    <div className={`mt-2 text-xl font-bold ${tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-navy-800"}`}>{value}</div>
  </div>
);

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b bg-navy-50 text-xs uppercase tracking-wide text-navy-800">{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap">{children}</tbody>
      </table>
      {empty && <p className="py-8 text-center text-sm text-slate-400">No records found / কোনো তথ্য নেই</p>}
    </div>
  );
}

export const PageTitle = ({ en, bn, action }: { en: string; bn: string; action?: React.ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
    <div><h1 className="text-2xl font-bold text-navy-800">{en}</h1><p className="text-sm text-slate-500">{bn}</p></div>{action}
  </div>
);
