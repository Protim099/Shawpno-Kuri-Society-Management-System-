"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useToast } from "./providers";

/** Fetches `path` and exposes data + reload. Errors surface as toasts. */
export function useLoad<T = any>(path: string | null, initial: T | null = null) {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); } catch (e: any) { toast(e.message, "err"); } finally { setLoading(false); }
  }, [path, toast]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload, setData };
}

/** Wraps a mutation: toast on success/failure, then run `after`. */
export function useAction() {
  const toast = useToast();
  return async (fn: () => Promise<any>, okMsg: string, after?: () => void) => {
    try { await fn(); toast(okMsg); after?.(); } catch (e: any) { toast(e.message, "err"); }
  };
}
