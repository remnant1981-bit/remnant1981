import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { parseSearchParams } from "@/domain/search";
import { searchWithMatches, saveMatches } from "@/server/recommend";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { RecommendPanel } from "@/components/RecommendPanel";
import { Pager } from "@/components/Pager";
import { Empty, Notice, PageTitle } from "@/components/ui";
import { bookmarkedIds } from "@/server/userdata";
import { profileCompleteness } from "@/domain/taxonomy";
import { GuestProfileClear } from "@/components/GuestProfileActions";
import { QuickFill } from "@/components/QuickFill";
import { pipelineStages } from "@/server/pipeline";

export const metadata: Metadata = { title: "맞춤 추천", alternates: { canonical: "/recommend" } };

const TABS = [
  { id: "priority", label: "우선 추천", desc: "자격 조건에 걸리는 것이 없고, 우리 기업과 관련 있다는 근거(기술·업종 일치, 관심 분야, 우리 시·군 공고 등)가 있는 공고입니다. 기술 분야·관심 분야를 선택할수록 정확해집니다." },
  { id: "all", label: "검토 가능 전체", desc: "자격 조건에 걸리는 것이 없는 모든 공고(적합 가능성 높음 + 추가 확인 필요)입니다. 관련성 근거가 없을 뿐 신청 가능할 수 있습니다." },
  { id: "met", label: "조건 충족만", desc: "입력한 기업정보로 확인한 신청 조건을 모두 충족한 공고만 보여 줍니다." },
  { id: "insufficient", label: "정보 부족", desc: "자동으로 확인된 조건이 아직 없는 공고입니다. 부적격이 아니라 판단 보류이며, 기업정보를 더 입력하거나 원문에서 확인하세요." },
  { id: "mismatch", label: "불일치 가능성", desc: "공고명·지원대상 등에서 읽은 조건(시·군, 업종, 기술 분야, 지원 대상 규모)이 우리 기업과 달라 보이는 공고입니다. 추정이 틀렸으면 카드에서 ‘해당함’을 선택하면 돌아갑니다. 공고에 명시된 지역과 충돌하는 공고는 포함하지 않습니다." },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const v = await getViewer();
  const profile = v.profile;
  if (profile) {
    const member = !!(v.company && v.session);
    const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "priority") as TabId;
    const page = typeof sp.page === "string" ? sp.page : "1";
    const db = await getDb();
    const p = parseSearchParams({ sort: "fit", size: "20", page, status: "open,upcoming,always,unknown", });
    const res = await searchWithMatches(db, p, profile, undefined, { view: tab });
    if (member) await saveMatches(db, v.company!.id, res.rows);
    const stages = member ? await pipelineStages(db, v.company!.id) : new Map<string, string>();
    const marks = member ? await bookmarkedIds(db, v.session!.user.id, v.company!.id) : new Set<string>();
    const c = res.counts ?? { likely_met: 0, needs_check: 0, likely_not_met: 0, insufficient: 0, possible_mismatch: 0, priority: 0, soon_met: 0 };
    const tabCount: Record<TabId, number> = { priority: c.priority, all: c.likely_met + c.needs_check - c.insufficient, met: c.likely_met, insufficient: c.insufficient, mismatch: c.possible_mismatch };
    const comp = profileCompleteness(profile as unknown as Record<string, unknown>);
    return (
      <>
        <PageTitle sub={`${v.company?.company_name ?? "우리 기업"} 기준 · 접수 중/예정/상시/상태 확인 필요 공고 대상${member ? "" : " · 이 브라우저에 저장한 정보 사용"}`}>맞춤 추천</PageTitle>
        {!member && (
          <details id="edit-profile" className="card mb-4 p-4">
            <summary className="cursor-pointer text-sm font-semibold">입력한 기업정보 수정하기</summary>
            <div className="mt-4"><RecommendPanel loggedIn={!!v.session} initial={v.guestProfile} /></div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><GuestProfileClear /><span className="text-[var(--muted)]">관심 공고 저장·알림이 필요하면 <Link className="underline" href="/register">회원가입</Link>(입력한 정보는 가입 후 불러올 수 있음)</span></div>
          </details>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div className="card p-4" title="자동 판정한 조건 비율 × 규칙 신뢰도의 평균(참고 지표)"><p className="text-xs text-[var(--muted)]">맞춤 정확도</p><p className="text-2xl font-bold text-blue-800">{res.accuracy === null ? "-" : `${res.accuracy}%`}</p>
            <div className="mt-1 h-1.5 rounded bg-gray-200" aria-hidden><div className="h-1.5 rounded bg-blue-600" style={{ width: `${res.accuracy ?? 0}%` }} /></div></div>
          <Link href="/recommend?tab=priority" className="card block p-4 hover:underline"><p className="text-xs text-[var(--muted)]">우선 추천</p><p className="text-2xl font-bold text-green-800">{c.priority.toLocaleString()}건</p>
            <p className="text-xs text-[var(--muted)]">관련성 근거 있음</p></Link>
          <Link href="/recommend?tab=all" className="card block p-4 hover:underline"><p className="text-xs text-[var(--muted)]">검토 가능 전체</p><p className="text-2xl font-bold text-amber-800">{tabCount.all.toLocaleString()}건</p>
            <p className="text-xs text-[var(--muted)]">정보 부족 {c.insufficient.toLocaleString()}건 별도</p></Link>
          <Link href="/recommend?tab=mismatch" className="card block p-4 hover:underline"><p className="text-xs text-[var(--muted)]">조건 불일치 가능성</p><p className="text-2xl font-bold text-rose-800">{c.possible_mismatch.toLocaleString()}건</p>
            <p className="text-xs text-[var(--muted)]">명시 조건 불일치 {(c.likely_not_met - c.possible_mismatch).toLocaleString()}건 제외</p></Link>
        </div>
        {(!profile.tech_fields || !profile.interest_categories || !profile.industry_group) && (
          <div className="mt-3"><Notice tone="warn"><strong>우선 추천을 정확하게:</strong> {[!profile.industry_group && "업종 분야", !profile.tech_fields && "주력 기술 분야", !profile.interest_categories && "관심 분야"].filter(Boolean).join(" · ")}를 선택하면 관련 공고만 골라 드립니다. <Link className="underline" href={member ? "/company" : "#edit-profile"}>기업정보에서 선택하기</Link></Notice></div>
        )}
        <QuickFill items={res.missing} accuracy={res.accuracy} member={member} />
        {comp.filled < 8 && res.missing.length === 0 && (
          <div className="mt-3"><Notice tone="warn">기업정보 {comp.total}개 항목 중 {comp.filled}개만 입력되어 ‘확인 필요’ 공고가 많습니다. <Link className="underline" href={member ? "/company" : "/recommend"}>기업정보를 더 입력</Link>하면 조건 충족 공고를 더 정확하게 골라 드립니다(모두 선택 입력).</Notice></div>
        )}
        <div role="tablist" aria-label="추천 보기" className="no-print mt-5 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-[var(--line)]">
          {TABS.map((t) => (
            <Link key={t.id} role="tab" aria-selected={tab === t.id} href={`/recommend?tab=${t.id}`}
              className={`-mb-px shrink-0 rounded-t-lg border px-3 py-2 text-sm font-semibold sm:px-4 ${tab === t.id ? "border-[var(--line)] border-b-white bg-white text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}>
              {t.label} <span className="ml-1 text-xs">({tabCount[t.id].toLocaleString()})</span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">{TABS.find((t) => t.id === tab)!.desc}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">‘판정 정확도’ = 자동 판정한 조건 비율 × 규칙 신뢰도(참고 지표). 기업정보를 더 입력할수록 높아집니다.</p>
        {tab === "met" && <div className="mt-2"><Notice>지역·기업 규모·업력·인증 등 <strong>자동으로 확인할 수 있는 조건</strong>을 모두 충족한 공고입니다. 공고 본문의 기타 조건(업종 한정, 제출서류 등)과 최종 신청 자격은 반드시 공식 원문과 담당기관에서 확인하세요.</Notice></div>}
        <div className="mt-4 grid gap-3">
          {res.rows.length ? res.rows.map((r) => <AnnouncementCard key={r.id} r={r} canBookmark={member} bookmarked={marks.has(r.id)} stage={stages.get(r.id)} />)
            : tab === "mismatch" ? <Empty title="추정 조건 때문에 제외한 공고가 없습니다." />
            : tab === "priority" ? <Empty title="관련성 근거가 있는 공고가 아직 없습니다.">기업정보에서 <strong>주력 기술 분야·업종 분야·관심 분야</strong>를 선택하면 우선 추천이 생깁니다. 자격에 걸리지 않는 공고는 <Link className="underline" href="/recommend?tab=all">검토 가능 전체</Link>에서 볼 수 있습니다.</Empty>
            : tab === "met"
              ? <Empty title="확인된 조건을 모두 충족한 공고가 아직 없습니다.">기업정보를 더 입력하거나 <Link className="underline" href="/recommend?tab=all">검토 가능 전체</Link> 탭에서 확인해 보세요.</Empty>
              : <Empty title="추천할 공고가 없습니다." />}
        </div>
        <Pager path="/recommend" base={`tab=${tab}`} page={res.page} pages={res.pages} />
        <p className="no-print mt-4 text-center text-sm"><Link className="underline" href={`/search?sort=fit&${tab === "met" ? "met=1" : tab === "mismatch" ? "" : "eligible=1"}`}>검색 조건(분야·지역·기간)을 더 걸어 보기 · 엑셀로 내보내기</Link></p>
      </>
    );
  }
  return (
    <>
      <PageTitle sub="기업정보 입력은 선택입니다. 입력한 항목만으로 추천합니다.">맞춤 추천</PageTitle>
      {v.session && v.membership !== "verified" && <div className="mb-4"><Notice tone="warn">기업 관계 확인이 완료되지 않았습니다. 아래 체험은 저장되지 않습니다. <Link className="underline" href="/company">기업 관계 확인 진행</Link></Notice></div>}
      <RecommendPanel loggedIn={!!v.session} />
    </>
  );
}
