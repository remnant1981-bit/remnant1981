import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { listPipeline } from "@/server/pipeline";
import { STAGES } from "@/domain/pipeline";
import { deadlineDays } from "@/domain/status";
import { seoulToday } from "@/lib/time";
import { DeadlineChip, Empty, Notice, PageTitle } from "@/components/ui";
import { StageSelect } from "@/components/PipelineControls";
import { companyPlan } from "@/server/plans";

export const metadata: Metadata = { title: "신청 진행 관리", robots: { index: false, follow: false } };

export default async function Page() {
  const v = await getViewer();
  if (!v.session || !v.company) {
    return (
      <>
        <PageTitle sub="관심 공고를 검토 → 신청 준비 → 신청 완료 → 결과까지 단계별로 관리합니다.">신청 진행 관리</PageTitle>
        <Notice tone="warn">진행 관리는 기업 구성원이 함께 쓰는 기능이라 {v.session ? <>기업 관계 확인이 필요합니다. <Link className="underline" href="/company">기업정보로 이동</Link></> : <><Link className="underline" href="/login">로그인</Link>이 필요합니다. 검색·맞춤 추천·관심 공고 저장은 로그인 없이 쓸 수 있습니다.</>}</Notice>
      </>
    );
  }
  const db = await getDb();
  const { items, members } = await listPipeline(db, v.session.user.id);
  const today = seoulToday();
  const active = items.filter((i) => !STAGES.find((s) => s.id === i.stage)?.done);
  const plan = await companyPlan(db, v.company.id);
  const cap = plan.limits.pipelineActive;
  return (
    <>
      <PageTitle sub={`${v.company.company_name ?? "우리 기업"} · 진행 중 ${active.length}건 · 전체 ${items.length}건${members.length > 1 ? ` · 구성원 ${members.length}명 공유` : ""}`}>신청 진행 관리</PageTitle>
      {Number.isFinite(cap) && (
        <div className="mb-3"><Notice tone={active.length >= cap ? "warn" : "info"}>{plan.label} 요금제 · 진행 중 <strong>{active.length}/{cap}건</strong>{active.length >= cap ? " — 한도에 도달해 새 공고를 진행 중으로 추가할 수 없습니다. 끝난 건을 선정·탈락·포기로 바꾸거나 " : " · 더 많이 관리하려면 "}<Link className="underline" href="/pricing">요금 안내</Link></Notice></div>
      )}
      {items.length === 0 && <Empty title="진행 관리 중인 공고가 없습니다.">공고 카드나 상세 화면의 <strong>‘＋ 진행 관리에 추가’</strong>에서 단계를 고르면 여기에 모입니다. <Link className="underline" href="/recommend">우리 기업 공고 보기</Link></Empty>}
      <div className="grid gap-6">
        {STAGES.map((s) => {
          const rows = items.filter((i) => i.stage === s.id);
          if (!rows.length) return null;
          return (
            <section key={s.id} aria-labelledby={`st-${s.id}`}>
              <h2 id={`st-${s.id}`} className="mb-2 font-bold">{s.label} <span className="text-sm font-normal text-[var(--muted)]">{rows.length}건</span></h2>
              <ul className="grid gap-2">
                {rows.map((i) => {
                  const d = !s.done && i.application_status === "open" ? deadlineDays(i.application_end, today) : null;
                  const hot = d !== null && d >= 0 && d <= 7;
                  const closed = !s.done && s.id !== "applied" && i.application_status === "closed";
                  return (
                    <li key={i.announcement_id} className="card grid gap-2 p-3 text-sm" style={hot ? { background: d! <= 3 ? "#fef2f2" : "#fff7ed", borderColor: d! <= 3 ? "#f87171" : "#fdba74" } : undefined}>
                      <div className="flex flex-wrap items-center gap-2">
                        <DeadlineChip d={hot ? d : null} />
                        {closed && <span className="chip bg-gray-100 text-gray-600">접수 마감됨</span>}
                        <Link className="font-semibold underline" href={`/announcements/${i.announcement_id}`}>{i.title}</Link>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--muted)]">
                        <span>{i.organization}</span>
                        <span>공고 마감 {i.application_end ?? "확인 필요"}</span>
                        {i.target_date && <span>내부 목표일 {i.target_date}</span>}
                        {i.assignee_email && <span>담당 {i.assignee_email}</span>}
                        <Link className="underline" href={`/announcements/${i.announcement_id}#pl`}>메모 {i.note_count}건</Link>
                        <span className="ml-auto"><StageSelect announcementId={i.announcement_id} stage={i.stage} compact /></span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
