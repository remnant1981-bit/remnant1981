"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { ProfileFields, formToProfile } from "./ProfileFields";
import { Notice } from "./ui";

const OVERALL: Record<string, [string, string]> = { likely_met: ["충족 가능성 높음", "chip-met"], needs_check: ["확인 필요", "chip-check"], likely_not_met: ["미충족 가능성 높음", "chip-notmet"] };
const STATE: Record<string, [string, string]> = { MET: ["충족", "chip-met"], NOT_MET: ["미충족", "chip-notmet"], UNKNOWN: ["확인 필요", "chip-check"] };

export function RecommendPanel() {
  const [res, setRes] = useState<any>(null);
  const [nts, setNts] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(""); setRes(null);
    const f = new FormData(e.currentTarget);
    const profile = formToProfile(f); delete profile.bizNo;
    const r = await api<any>("POST", "/api/match/preview", { profile });
    setBusy(false);
    if (r.ok) setRes(r.data); else setErr(r.data.message ?? "분석하지 못했습니다.");
  }
  async function lookup() {
    const el = document.getElementById("bizNo") as HTMLInputElement;
    setNts(null); setErr("");
    const r = await api<any>("POST", "/api/nts/status", { bizNo: el.value });
    if (r.ok) setNts(r.data); else setErr(r.data.message ?? "조회하지 못했습니다.");
  }
  return (
    <div className="grid gap-5">
      <Notice>비회원 체험입니다. 입력한 기업정보는 <strong>저장되지 않으며</strong> 이 분석에만 사용됩니다. 저장·이력·알림이 필요하면 <Link className="underline" href="/register">회원가입</Link> 후 기업 관계 확인을 진행하세요.</Notice>
      <section className="card grid gap-2 p-5">
        <h2 className="font-bold">① 사업자 상태조회 (선택)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div><label htmlFor="bizNo" className="label">사업자등록번호</label><input id="bizNo" inputMode="numeric" className="input" autoComplete="off" placeholder="000-00-00000" /></div>
          <button type="button" className="btn btn-ghost" onClick={lookup}>상태 조회</button>
        </div>
        {nts && <div role="status" className="rounded-lg border border-[var(--line)] p-3 text-sm">
          {nts.notice && <p className="mb-1 font-semibold text-amber-800">⚠ {nts.notice}</p>}
          <p>번호 {nts.status.masked} · 사업자 상태 <strong>{nts.status.statusText ?? "확인 불가"}</strong> · 과세유형 {nts.status.taxType ?? "-"}</p>
          <p className="mt-1 text-[var(--muted)]">상태조회로는 사업자 상태·과세유형만 확인됩니다. 나머지 정보는 아래에 직접 입력(선택)하세요.</p></div>}
      </section>
      <form onSubmit={run} className="card grid gap-4 p-5" aria-label="기업정보 입력">
        <h2 className="font-bold">② 기업정보 선택 입력</h2>
        <ProfileFields />
        <button className="btn w-fit" disabled={busy}>{busy ? "분석 중…" : "③ 맞춤 추천 실행"}</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      {res && (
        <section aria-live="polite" className="grid gap-3">
          <h2 className="font-bold">추천 결과 {res.total}건 <span className="text-sm font-normal text-[var(--muted)]">(참고용 · 상위 {res.rows.length}건)</span></h2>
          {res.rows.map((r: any) => (
            <article key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${OVERALL[r.match.overall][1]}`}>{OVERALL[r.match.overall][0]}</span>
                {r.match.score !== null && <span className="text-xs text-[var(--muted)]">참고 점수 {r.match.score}</span>}
                {r.local && <span className="chip bg-teal-100 text-teal-900">내 지역</span>}
                {r.source_status === "mock" && <span className="chip chip-test">테스트 데이터</span>}
              </div>
              <h3 className="mt-1 font-semibold"><Link className="hover:underline" href={`/announcements/${r.id}`}>{r.title}</Link></h3>
              <p className="text-sm text-[var(--muted)]">{r.organization} · {r.region_scope}</p>
              <ul className="mt-2 grid gap-1 text-sm">
                {r.match.results.length === 0 && <li className="text-[var(--muted)]">자동 판정 가능한 조건이 없습니다. 원문을 확인하세요.</li>}
                {r.match.results.map((x: any, i: number) => (
                  <li key={i}><span className={`chip ${STATE[x.state][1]}`}>{STATE[x.state][0]}</span> <strong>{x.label}</strong> — {x.reason}{x.excerpt && <em className="text-[var(--muted)]"> (근거: “{x.excerpt}”)</em>}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
