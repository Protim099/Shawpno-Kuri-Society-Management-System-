export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export const getToken = () => (typeof window === "undefined" ? null : localStorage.getItem("samiti_token"));

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: any[]) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(API_URL + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
      localStorage.removeItem("samiti_token");
      window.location.href = "/login";
    }
    const detail = data.issues?.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ApiError(res.status, detail ? `${data.error} (${detail})` : data.error || "Request failed", data.issues);
  }
  return data as T;
}

/** Download an authenticated file (PDF / Excel) or open printable HTML. */
export async function download(path: string, filename: string) {
  const res = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (filename.endsWith(".html")) { window.open(url, "_blank"); return; }
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const num = (v: any) => Number(v ?? 0);
export const money = (v: any) =>
  "৳" + num(v).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fdate = (v: any) => (v ? String(v).slice(0, 10) : "—");
export const today = () => new Date().toISOString().slice(0, 10);
