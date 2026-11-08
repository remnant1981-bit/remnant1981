"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { ProfileFields, formToProfile } from "./ProfileFields";
import { encodeGuestProfile, GUEST_COOKIE } from "@/lib/guest-profile";
import { AccuracyChip, Notice } from "./ui";

const OVERALL: Record<string, [string, string]> = { likely_met: ["충족 가능성 높음", "chip-met"], needs_check: ["확인 필요", "chip-check"], likely_not_met: ["미충족 가능성 높음", "chip-notmet"] };
const STATE: Record<string, [string, string]> = { MET: ["충족", "chip-met"], NOT_MET: ["미충족", "chip-notmet"], UNKNOWN: ["확인 필요", "chip-check"] };

export function RecommendPanel({ loggedIn = false, initial }: { loggedIn?: boolean; initial?: Record<string, string> | null }) {
  const [res, setRes] = useState<any>(null);
  const [nts, setNts] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"met" | "all">("all");
  const [remember, setRemember] = useState(true);
  const router = useRouter();

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(""); setRes(null);
    const f = new FormData(e.currentTarget);
    const profile = formToProfile(f); delete profile.bizNo;
    // 같은 브라우저 세션 안에서만 임시 보관(가입 후 기업정보 화면에서 불러오기용). 서버에는 저장하지 않음
    try { sessionStorage.setItem("gbf_profile_draft", JSON.stringify(profile)); } catch { /* 저장 불가 환경 무시 */ }
    if (remember) {
      // 이 브라우저에만 보관(180일). 서버에는 저장하지 않으며 식별 정보는 담지 않는다
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${GUEST_COOKIE}=${encodeGuestProfile(profile)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax${secure}`;
      setBusy(false);
      router.push("/recommend");
      router.refresh();
      return;
    }
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
      <Notice><strong>로그인 없이</strong> 바로 쓸 수 있습니다. 아는 항목만 입력하세요(모두 선택). 관심 공고 저장·이력·알림이 필요할 때만 <Link className="underline" href="/register">회원가입</Link>하면 됩니다.</Notice>
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
        <ProfileFields v={initial ?? {}} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1" /> <span>이 브라우저에 기억하기 <span className="block text-xs text-[var(--muted)]">다음 방문 때 다시 입력하지 않아도 됩니다. 서버에는 저장하지 않으며 사업자번호·기업명은 담지 않습니다. 공용 PC에서는 체크를 해제하세요.</span></span></label>
        <button className="btn w-fit" disabled={busy}>{busy ? "분석 중…" : "③ 맞춤 추천 실행"}</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      {res && (() => {
        const met = res.rows.filter((r: any) => r.match.overall === "likely_met");
        const shown = tab === "met" ? met : res.rows;
        return (
        <section aria-live="polite" className="grid gap-3">
          <h2 className="font-bold">추천 결과 <span className="text-sm font-normal text-[var(--muted)]">(참고용)</span></h2>
          <p className="text-sm">조건 충족 <strong className="text-green-800">{res.counts?.likely_met ?? 0}건</strong> · 확인 필요 <strong className="text-amber-800">{res.counts?.needs_check ?? 0}건</strong> · 해당 안 됨(제외) {res.excluded}건</p>
          <div role="tablist" className="flex gap-1 border-b border-[var(--line)]">
            {([["all", `맞춤 공고 (${(res.counts?.likely_met ?? 0) + (res.counts?.needs_check ?? 0)})`], ["met", `조건 충족만 (${res.counts?.likely_met ?? 0})`]] as const).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`-mb-px rounded-t-lg border px-4 py-2 text-sm font-semibold ${tab === k ? "border-[var(--line)] border-b-white bg-white text-[var(--brand)]" : "border-transparent text-[var(--muted)]"}`}>{t}</button>
            ))}
          </div>
          {tab === "met" && <p className="text-xs text-[var(--muted)]">자동으로 확인할 수 있는 조건(지역·규모·업력·인증 등)을 모두 충족한 공고입니다. 본문의 기타 조건과 최종 자격은 원문에서 확인하세요.</p>}
          <div className="card bg-[var(--brand-soft)] p-4 text-sm">
            {loggedIn
              ? <>입력한 정보를 <Link className="font-semibold underline" href="/company">기업정보</Link>에 저장하면 다음부터 다시 입력하지 않아도 되고, 새 공고·마감 임박 알림을 받을 수 있습니다.</>
              : <><strong>이 정보를 저장하고 맞춤 알림을 받으려면</strong> <Link className="font-semibold underline" href="/register">회원가입</Link> 후 기업정보 화면에서 불러오기만 하면 됩니다(같은 브라우저에서 자동으로 채워짐).</>}
          </div>
          {shown.length === 0 && <p className="text-sm text-[var(--muted)]">이 탭에 해당하는 공고가 없습니다. 기업정보를 더 입력하거나 ‘맞춤 공고’ 탭을 확인해 보세요.</p>}
          {shown.map((r: any) => (
            <article key={r.id} className="card p-4" style={{ borderLeft: `4px solid ${r.match.overall === "needs_check" ? "#f59e0b" : "#22c55e"}` }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${OVERALL[r.match.overall][1]}`}>{OVERALL[r.match.overall][0]}</span>
                <AccuracyChip match={r.match} />
                {r.local && <span className="chip bg-teal-100 text-teal-900">내 지역</span>}
                {r.source_status === "mock" && <span className="chip chip-test">테스트 데이터</span>}
                <span className="text-xs text-[var(--muted)]">접수 {r.application_start || r.application_end ? `${r.application_start ?? "확인 필요"} ~ ${r.application_end ?? "확인 필요"}` : "기간 원문 확인"}</span>
              </div>
              <h3 className="mt-1 font-semibold"><Link className="hover:underline" href={`/announcements/${r.id}`}>{r.title}</Link></h3>
              <p className="text-sm text-[var(--muted)]">{r.organization} · {r.region_scope}</p>
              {r.match.overall === "needs_check" && r.match.missingLabels?.length > 0 && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950">✎ 기업정보 미입력: {r.match.missingLabels.join(", ")} — 입력하면 자동 판정됩니다.</p>}
              <ul className="mt-2 grid gap-1 text-sm">
                {r.match.results.length === 0 && <li className="text-[var(--muted)]">자동 판정 가능한 조건이 없습니다. 원문을 확인하세요.</li>}
                {r.match.results.map((x: any, i: number) => (
                  <li key={i} className={x.state === "UNKNOWN" ? "rounded bg-amber-50 px-1" : ""}><span className={`chip ${STATE[x.state][1]}`}>{STATE[x.state][0]}</span> <strong>{x.label}</strong> — {x.reason}{x.excerpt && <em className="text-[var(--muted)]"> (근거: “{x.excerpt}”)</em>}</li>
                ))}
              </ul>
            </article>
          ))}
          {res.total > res.rows.length && <p className="text-sm text-[var(--muted)]">상위 {res.rows.length}건만 표시했습니다(전체 {res.total}건). 회원으로 저장하면 전체 목록과 페이지 이동, 엑셀 내보내기를 쓸 수 있습니다.</p>}
        </section>
        );
      })()}
    </div>
  );
}
