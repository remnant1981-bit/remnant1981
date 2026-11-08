import Link from "next/link";
import type { RowWithMatch } from "@/server/recommend";
import { CategoryTags, FitChip, Provenance, StatusChip, TestBadge } from "./ui";
import { BookmarkButton } from "./BookmarkButton";
import { deadlineDays } from "@/domain/status";
import { seoulToday } from "@/lib/time";
import { shortSummary } from "@/lib/format";

export function AnnouncementCard({ r, canBookmark, bookmarked }: { r: RowWithMatch; canBookmark: boolean; bookmarked?: boolean }) {
  const d = r.application_status === "open" ? deadlineDays(r.application_end, seoulToday()) : null;
  const soon = d !== null && d >= 0 && d <= 7;
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={r.application_status} basis={r.status_basis} />
        {soon && <span className="chip chip-unknown">마감 {d === 0 ? "오늘" : `D-${d}`}</span>}
        {r.local && <span className="chip bg-teal-100 text-teal-900">내 지역</span>}
        <CategoryTags ids={r.category_ids} />
        <TestBadge status={r.source_status} name={r.source_name} />
        {r.match && <FitChip match={r.match} />}
      </div>
      <h2 className="mt-2 text-lg font-semibold leading-snug">
        <Link href={`/announcements/${r.id}`} className="hover:underline">{r.title}</Link>
      </h2>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div><dt className="inline text-[var(--muted)]">기관 </dt><dd className="inline font-medium">{r.organization}</dd></div>
        <div><dt className="inline text-[var(--muted)]">지역 </dt><dd className="inline font-medium">{r.region_scope}</dd></div>
        <div><dt className="inline text-[var(--muted)]">대상 </dt><dd className="inline font-medium">{r.target_summary || "확인 필요"}</dd></div>
        <div><dt className="inline text-[var(--muted)]">접수 </dt><dd className="inline font-medium">{r.application_start || r.application_end ? `${r.application_start ?? "확인 필요"} ~ ${r.application_end ?? (r.application_status === "always" ? "상시" : "확인 필요")}` : r.application_status === "always" ? "상시 접수" : "기간 원문 확인"}</dd></div>
      </dl>
      <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{r.support_amount_text || shortSummary(r.support_summary) || "지원내용은 상세 페이지에서 확인하세요."}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Provenance url={r.canonical_url} sourceName={r.source_name} sourceStatus={r.source_status} checkedAt={r.last_checked_at} />
        {canBookmark && <BookmarkButton announcementId={r.id} initial={!!bookmarked} />}
      </div>
    </article>
  );
}
