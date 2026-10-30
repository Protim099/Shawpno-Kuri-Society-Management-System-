"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

export interface User { id: number; name: string; email: string; role: "SUPER_ADMIN" | "ADMIN" | "ACCOUNTANT" | "MEMBER"; memberId: number | null }

const AuthCtx = createContext<{ user: User | null; loading: boolean; login: (t: string, u: User) => void; logout: () => void }>(null as any);
const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useAuth = () => useContext(AuthCtx);
export const useToast = () => useContext(ToastCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);

  useEffect(() => {
    if (!localStorage.getItem("samiti_token")) { setLoading(false); return; }
    api<User>("/auth/me").then(setUser).catch(() => localStorage.removeItem("samiti_token")).finally(() => setLoading(false));
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const login = (t: string, u: User) => { localStorage.setItem("samiti_token", t); setUser(u); };
  const logout = () => { localStorage.removeItem("samiti_token"); setUser(null); window.location.href = "/login"; };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div className="fixed bottom-4 right-4 z-[100] space-y-2 no-print">
          {toasts.map((t) => (
            <div key={t.id} className={`rounded-md px-4 py-3 text-sm text-white shadow-lg max-w-sm ${t.kind === "err" ? "bg-expense" : "bg-income"}`}>{t.msg}</div>
          ))}
        </div>
      </ToastCtx.Provider>
    </AuthCtx.Provider>
  );
}
