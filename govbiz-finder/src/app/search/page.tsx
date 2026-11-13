import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { listFacets, parseSearchParams, toQueryString } from "@/domain/search";
import { searchWithMatches } from "@/server/recommend";
import { getViewer } from "@/server/viewer";
import { bookmarkedIds } from "@/server/userdata";
import { pipelineStages } from "@/server/pipeline";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { SearchForm } from "@/components/SearchForm";
import { Empty, Notice, PageTitle } from "@/components/ui";
import { Pager } from "@/components/Pager";
import { AdSlot } from "@/components/AdSlot";
import { companyPlan } from "@/server/plans";
import { Fragment } from "react";

export const metadata: Metadata = { title: "공고 검색", alternates: { canonical: "/search" } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = parseSearchParams(sp);
  const db = await getDb();
  const v = await getViewer();
  const adPlan = await companyPlan(db, v.company?.id);
  const [res, facets, total] = await Promise.all([
    searchWithMatches(db, p, v.profile),
    listFacets(db),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements WHERE is_active=1"),
  ]);
  const stages = v.company ? await pipelineStages(db, v.company.id) : new Map<string, string>();
  const marks = v.company && v.session ? await bookmarkedIds(db, v.session.user.id, v.company.id) : new Set<string>();
  const exportQs = toQueryString({ ...p, page: 1 });
  return (
    <>
      <PageTitle sub={`검색 결과 ${res.total.toLocaleString()}건`}>공고 검색</PageTitle>
      <SearchForm p={p} orgs={facets.organizations} />
      {p.sort === "fit" && !v.profile && <div className="mt-3"><Notice tone="warn">기업 적합도순은 우리 기업 정보가 있을 때 적용됩니다. 최신순으로 표시합니다. <Link href="/recommend" className="underline">로그인 없이 기업정보 입력하기</Link></Notice></div>}
      {p.metOnly && !v.profile && <div className="mt-3"><Notice tone="warn">‘조건 충족 공고만’은 우리 기업 정보가 있을 때 적용됩니다. 지금은 전체 공고를 표시합니다. <Link href="/recommend" className="underline">로그인 없이 기업정보 입력하기</Link></Notice></div>}
      {p.metOnly && v.profile && <div className="mt-3"><Notice>자동으로 확인할 수 있는 조건(지역·규모·업력·인증 등)을 모두 충족한 공고만 표시합니다. 본문의 기타 조건과 최종 자격은 원문에서 확인하세요.</Notice></div>}
      {p.eligible && !v.profile && <div className="mt-3"><Notice tone="warn">‘해당 가능한 공고만’은 우리 기업 정보가 있을 때 적용됩니다. 지금은 전체 공고를 표시합니다. <Link href="/recommend" className="underline">로그인 없이 기업정보 입력하기</Link></Notice></div>}
      {p.eligible && v.profile && <div className="mt-3"><Notice>‘미충족 가능성 높음’ 공고를 제외했습니다. 입력하지 않은 항목이 있는 공고는 ‘확인 필요’로 남아 있으니 원문을 확인하세요.</Notice></div>}
      {v.profile && p.region === "" && v.profile.region_sido && <div className="mt-3"><Notice>기업 소재지({v.profile.region_sido})의 지역 공고에는 ‘내 지역’ 표시가 붙으며, 전국 공고도 함께 표시됩니다.</Notice></div>}
      <div className="no-print mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span>현재 조건으로 내보내기:</span>
        <a className="btn btn-ghost" href={`/api/export/xlsx?${exportQs}`}>XLSX</a>
        <a className="btn btn-ghost" href={`/api/export/csv?${exportQs}`}>CSV</a>
        <a className="btn btn-ghost" href={`/api/export/pdf?${exportQs}`}>PDF</a>
      </div>
      <div className="mt-4 grid gap-3" aria-live="polite">
        {res.rows.length === 0 ? (
          (total?.n ?? 0) === 0
            ? <Empty title="수집된 공고가 없습니다.">공고 수집이 아직 실행되지 않았거나 연동된 원천이 없습니다. 검색 결과 없음이 아니라 <strong>데이터 수집 상태</strong> 문제일 수 있습니다.</Empty>
            : <Empty title="조건에 맞는 공고가 없습니다.">검색어나 필터를 줄여 보세요. (수집된 공고 {total?.n}건 중 일치 항목 없음)</Empty>
        ) : res.rows.map((r, i) => (
          <Fragment key={r.id}>
            <AnnouncementCard r={r} canBookmark={!!v.company} bookmarked={marks.has(r.id)} stage={stages.get(r.id)} />
            {i === 4 && <AdSlot show={adPlan.limits.ads} slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIST} />}
          </Fragment>
        ))}
      </div>
      <Pager path="/search" base={toQueryString({ ...p, page: 1 })} page={res.page} pages={res.pages} />
    </>
  );
}
