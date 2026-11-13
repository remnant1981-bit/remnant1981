import Link from "next/link";
import type { RowWithMatch } from "@/server/recommend";
import { AccuracyChip, CategoryTags, DeadlineChip, FitChip, Provenance, StatusChip, TestBadge } from "./ui";
import { BookmarkButton } from "./BookmarkButton";
import { InlineFill } from "./InlineFill";
import { StageSelect } from "./PipelineControls";
import { ConditionCheck } from "./ConditionCheck";
import { checkableConditions } from "@/domain/matching";
import { deadlineDays } from "@/domain/status";
import { seoulToday } from "@/lib/time";
import { shortSummary } from "@/lib/format";

export function AnnouncementCard({ r, canBookmark, bookmarked, stage }: { r: RowWithMatch; canBookmark: boolean; bookmarked?: boolean; stage?: string | null }) {
  const d = r.application_status === "open" ? deadlineDays(r.application_end, seoulToday()) : null;
  const soon = d !== null && d >= 0 && d <= 7;
  const check = r.match?.overall === "needs_check";
  const disp = r.match?.display;
  const border = disp === "met" ? "#22c55e" : disp === "check" ? "#f59e0b" : disp === "insufficient" ? "#9ca3af" : disp === "possible_mismatch" ? "#fb7185" : undefined;
  return (
    <article className={`card p-4 ${soon && bookmarked ? "ring-2 ring-red-400" : ""} ${disp === "not_met" ? "opacity-75" : ""}`} style={border ? { borderLeft: `4px solid ${border}` } : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={r.application_status} basis={r.status_basis} />
        {soon && <DeadlineChip d={d} />}
        {r.local && <span className="chip bg-teal-100 text-teal-900">내 지역</span>}
        <CategoryTags ids={r.category_ids} />
        <TestBadge status={r.source_status} name={r.source_name} />
        {r.match && <FitChip match={r.match} />}
        {r.match && r.match.overall !== "likely_not_met" && <AccuracyChip match={r.match} />}
        {r.match && r.match.overall !== "likely_not_met" && r.relevance?.reasons.filter((x) => x !== "우리 시·도 공고").map((x) => <span key={x} className="chip border border-indigo-200 bg-indigo-50 text-indigo-900">★ {x}</span>)}
      </div>
      {soon && bookmarked && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800">★ 관심 공고 · {d === 0 ? "오늘 마감입니다" : `마감까지 ${d}일 남았습니다`} — 신청 서류를 확인하세요</p>
      )}
      <h2 className="mt-2 text-lg font-semibold leading-snug">
        <Link href={`/announcements/${r.id}`} className="hover:underline">{r.title}</Link>
      </h2>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div><dt className="inline text-[var(--muted)]">기관 </dt><dd className="inline font-medium">{r.organization}</dd></div>
        <div><dt className="inline text-[var(--muted)]">지역 </dt><dd className="inline font-medium">{r.region_scope}</dd></div>
        <div><dt className="inline text-[var(--muted)]">대상 </dt><dd className="inline font-medium">{r.target_summary || "확인 필요"}</dd></div>
        <div><dt className="inline text-[var(--muted)]">접수 </dt><dd className="inline font-medium">{r.application_start || r.application_end ? `${r.application_start ?? "확인 필요"} ~ ${r.application_end ?? (r.application_status === "always" ? "상시" : "확인 필요")}` : r.application_status === "always" ? "상시 접수" : "기간 원문 확인"}</dd></div>
      </dl>
      {check && r.match && <CheckHighlight r={r} member={canBookmark} />}
      {disp === "not_met" && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-900">
          조건 불일치 확인 — {r.match!.results.filter((x) => x.state === "NOT_MET").map((x) => x.reason).slice(0, 2).join(" / ")}
        </p>
      )}
      {disp === "possible_mismatch" && (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-950">
          조건 불일치 가능성(공고 문구로 추정) — {r.match!.results.filter((x) => x.state === "NOT_MET").map((x) => x.reason).slice(0, 2).join(" / ")}
          <span className="block text-xs text-rose-800">추정이 틀렸다면 아래에서 ‘해당함’을 선택하면 맞춤 공고로 돌아갑니다.</span>
        </p>
      )}
      {r.match && disp !== "not_met" && <ConditionCheck announcementId={r.id} member={canBookmark} items={checkableConditions(r.match)} />}
      <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{r.support_amount_text || shortSummary(r.support_summary) || "지원내용은 상세 페이지에서 확인하세요."}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Provenance url={r.canonical_url} sourceName={r.source_name} sourceStatus={r.source_status} checkedAt={r.last_checked_at} />
        <span className="flex flex-wrap items-center gap-2">
          {canBookmark && <StageSelect announcementId={r.id} stage={stage ?? null} compact />}
          <BookmarkButton announcementId={r.id} initial={!!bookmarked} guest={!canBookmark} meta={{ title: r.title, organization: r.organization, end: r.application_end }} />
        </span>
      </div>
    </article>
  );
}

/** '확인 필요' 공고에서 무엇을 확인해야 하는지 한눈에 보여 준다. */
function CheckHighlight({ r, member }: { r: RowWithMatch; member: boolean }) {
  const m = r.match!;
  const met = m.results.filter((x) => x.state === "MET").map((x) => x.label);
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <p className="font-semibold">{m.display === "insufficient" ? "정보 부족 — 자동으로 판정할 근거가 아직 없습니다. 아래 정보를 입력하거나 공식 원문에서 자격을 확인하세요." : "추가 확인 필요 — 신청 가능할 수 있는 공고입니다"}</p>
      <ul className="mt-1 space-y-0.5">
        {met.length > 0 && <li>✔ 충족 확인: {[...new Set(met)].join(", ")}</li>}
        {m.results.length === 0 && <li>? 자동으로 확인할 수 있는 조건이 없어 공고 원문에서 자격을 확인해야 합니다.</li>}
      </ul>
      <InlineFill member={member} sido={r.region_scope} fields={[...new Map(m.results.filter((x) => x.missing).map((x) => [x.fieldKey, { fieldKey: x.fieldKey, label: x.label }])).values()]} />
    </div>
  );
}

