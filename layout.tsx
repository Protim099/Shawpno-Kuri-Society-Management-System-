"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Users, PiggyBank, HandCoins, CalendarClock, BookOpen, Receipt, FileBarChart, Settings, UserCog, LogOut, Menu, Landmark, User } from "lucide-react";
import { useAuth } from "@/lib/providers";

const NAV = [
  { href: "/dashboard", en: "Dashboard", bn: "ড্যাশবোর্ড", icon: LayoutDashboard, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/members", en: "Members", bn: "সদস্য", icon: Users, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/savings", en: "Savings", bn: "সঞ্চয়", icon: PiggyBank, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/loans", en: "Loans", bn: "ঋণ", icon: HandCoins, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/installments", en: "Installments", bn: "কিস্তি", icon: CalendarClock, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/transactions", en: "Transactions", bn: "লেনদেন", icon: BookOpen, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/expenses", en: "Expenses", bn: "খরচ", icon: Receipt, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/reports", en: "Reports", bn: "রিপোর্ট", icon: FileBarChart, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
  { href: "/users", en: "Users & Roles", bn: "ব্যবহারকারী", icon: UserCog, roles: ["SUPER_ADMIN", "ADMIN"] },
  { href: "/settings", en: "Settings", bn: "সেটিংস", icon: Settings, roles: ["SUPER_ADMIN", "ADMIN"] },
  { href: "/my", en: "My Account", bn: "আমার হিসাব", icon: User, roles: ["MEMBER"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { if (user?.role === "MEMBER" && !path.startsWith("/my")) router.replace("/my"); }, [user, path, router]);
  if (loading || !user) return <div className="flex h-screen items-center justify-center text-slate-400">Loading...</div>;

  const items = NAV.filter((n) => n.roles.includes(user.role));
  return (
    <div className="min-h-screen lg:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-navy-900 text-slate-200 transition lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5"><Landmark className="text-white" /><div><div className="font-bold text-white leading-tight">Samiti</div><div className="text-[11px] text-slate-400">সমিতি ম্যানেজমেন্ট</div></div></div>
        <nav className="space-y-1 p-3">
          {items.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${active ? "bg-white text-navy-800 font-semibold" : "hover:bg-white/10"}`}>
                <n.icon size={18} /><span>{n.en}</span><span className="ml-auto text-[11px] opacity-60">{n.bn}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-white px-4 py-3">
          <button className="lg:hidden" onClick={() => setOpen(true)}><Menu /></button>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-right"><span className="block font-medium text-navy-800">{user.name}</span><span className="block text-xs text-slate-500">{user.role.replace("_", " ")}</span></span>
            <button onClick={logout} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Logout"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
