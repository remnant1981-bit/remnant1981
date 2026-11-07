"use client";
import { useState } from "react";
import { api, resetCsrf } from "@/lib/client";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const f = new FormData(e.currentTarget);
    const r = await api<{ message?: string }>("POST", `/api/auth/${mode}`, { email: f.get("email"), password: f.get("password") });
    setBusy(false);
    resetCsrf();
    if (r.ok) window.location.href = mode === "register" ? "/company" : "/";
    else setErr(r.data.message ?? "처리하지 못했습니다.");
  }
  return (
    <form onSubmit={submit} className="card mx-auto grid max-w-md gap-4 p-6" aria-label={mode === "login" ? "로그인" : "회원가입"}>
      <div><label htmlFor="email" className="label">이메일</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
      <div>
        <label htmlFor="password" className="label">비밀번호{mode === "register" && " (10자 이상, 영문+숫자)"}</label>
        <input id="password" name="password" type="password" required minLength={mode === "register" ? 10 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} className="input" />
      </div>
      {mode === "register" && <p className="text-xs text-[var(--muted)]">계정 생성과 <strong>기업 관계 확인</strong>은 별개입니다. 사업자등록번호는 인증수단이 아니며, 기업 데이터는 확인 완료 후에만 이용할 수 있습니다.</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button className="btn" disabled={busy}>{busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}</button>
    </form>
  );
}
