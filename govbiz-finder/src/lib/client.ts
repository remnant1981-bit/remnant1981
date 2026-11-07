"use client";
// 클라이언트 fetch 헬퍼: CSRF 토큰을 /api/auth/me 에서 받아 변경 요청에 첨부.
let csrf: string | null = null;
async function token(): Promise<string | null> {
  if (csrf) return csrf;
  const r = await fetch("/api/auth/me", { cache: "no-store" });
  const j = await r.json();
  csrf = j.csrf ?? null;
  return csrf;
}
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (method !== "GET") {
    const t = await token();
    if (t) headers["x-csrf-token"] = t;
  }
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && (data as any)?.error === "csrf_token") csrf = null;
  return { ok: res.ok, status: res.status, data: data as T };
}
export function resetCsrf() { csrf = null; }
