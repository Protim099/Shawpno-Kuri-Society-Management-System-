"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, useToast } from "@/lib/providers";
import { Button, Input, Field } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const toast = useToast();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api("/auth/login", { body: { email, password } });
      login(r.token, r.user);
      router.push(r.user.role === "MEMBER" ? "/my" : "/dashboard");
    } catch (err: any) { toast(err.message, "err"); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-2xl">
        <div className="text-center"><Landmark className="mx-auto mb-2 text-navy-800" size={36} /><h1 className="text-xl font-bold text-navy-800">Samiti Management System</h1><p className="text-sm text-slate-500">সমিতি ম্যানেজমেন্ট সিস্টেম</p></div>
        <Field label="Email / ইমেইল"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Password / পাসওয়ার্ড"><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button className="w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in / লগইন"}</Button>
      </form>
    </div>
  );
}
