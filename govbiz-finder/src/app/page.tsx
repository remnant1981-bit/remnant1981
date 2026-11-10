import Link from "next/link";
import { getDb } from "@/server/db";
import { parseSearchParams, searchAnnouncements, listFacets } from "@/domain/search";
import { attachMatches } from "@/server/recommend";
import { getViewer } from "@/server/viewer";
import { CATEGORIES } from "@/domain/taxonomy";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { SearchForm } from "@/components/SearchForm";
import { Empty, Notice } from "@/components/ui";
import { formatSeoul } from "@/lib/time";
import { searchWithMatches } from "@/server/recommend";
import { AdSlot } from "@/components/AdSlot";
import { InstallApp } from "@/components/InstallApp";

export default async function Home() {
  const db = await getDb();
  const v = await getViewer();
  const [open, soon, fresh, facets, meta] = await Promise.all([
    searchAnnouncements(db, parseSearchParams({ status: "open", sort: "latest", size: "5" })),
    searchAnnouncements(db, parseSearchParams({ soon: "1", sort: "deadline", size: "5" })),
    searchAnnouncements(db, parseSearchParams({ sort: "latest", size: "5" })),
    listFacets(db),
    db.get<{ last: string | null; total: number; live: number; mock: number }>(
      `SELECT (SELECT MAX(last_checked_at) FROM announcements WHERE is_active=1) AS last, (SELECT COUNT(*) FROM announcements WHERE is_active=1) AS total,
       (SELECT COUNT(*) FROM data_sources WHERE enabled=1 AND integration_status='live') AS live,
       (SELECT COUNT(*) FROM data_sources WHERE enabled=1 AND integration_status='mock') AS mock`),
  ]);
  // 기업정보가 있으면 '해당 안 됨' 공고는 홈 목록에서 제외(전체는 '더 보기'의 검색에서 확인)
  const section = async (title: string, id: string, res: typeof open, more: string) => {
    let rows = await attachMatches(db, res.rows, null);
    if (v.profile) {
      // 상위 50건만 판정해 해당 가능 공고 5건을 고른다(전체 판정 반복 방지). 부족할 때만 전체 판정으로 보완
      const q = parseSearchParams(Object.fromEntries(new URLSearchParams(more.split("?")[1] ?? "")));
      const head = await attachMatches(db, (await searchAnnouncements(db, { ...q, page: 1, pageSize: 50 })).rows, v.profile);
      rows = head.filter((r) => r.match!.overall !== "likely_not_met").slice(0, 5);
      if (rows.length < 5 && head.length === 50) rows = (await searchWithMatches(db, { ...q, pageSize: 5, eligible: true }, v.profile)).rows;
    }
    if (v.profile) { title = `${title} · 우리 기업 해당 가능`; more = `${more}&eligible=1`; }
    return (
      <section aria-labelledby={id} className="mt-8">
        <div className="mb-2 flex items-baseline justify-between"><h2 id={id} className="text-lg font-bold">{title}</h2><Link href={more} className="text-sm underline">더 보기</Link></div>
        {rows.length ? <div className="grid gap-3">{rows.map((r) => <AnnouncementCard key={r.id} r={r} canBookmark={!!v.company} />)}</div> : <Empty title="해당하는 공고가 없습니다." />}
      </section>
    );
  };
  return (
    <>
      <section className="rounded-3xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 px-6 py-10 text-white shadow-lg sm:px-10 sm:py-12">
        <p className="text-sm opacity-90">몰라서 놓치는 지원사업이 없도록</p>
        <h1 className="mt-1 text-3xl font-extrabold leading-tight">기업지원사업, 한 번에 찾고<br className="sm:hidden" /> 공식 원문으로 확인하세요</h1>
        <p className="mt-3 text-sm opacity-90">회원가입 없이 검색할 수 있습니다. 기업정보 입력은 선택사항입니다.</p>
      </section>
      <div className="-mt-6 px-2"><SearchForm p={{}} compact /></div>
      <InstallApp />

      {v.profile && await (async (company) => {
        const base = parseSearchParams({ sort: "fit", size: "1", status: "open,upcoming,always,unknown", eligible: "1" });
        const all = await searchWithMatches(db, base, company);
        const c = all.counts ?? { likely_met: 0, needs_check: 0, likely_not_met: 0, insufficient: 0, possible_mismatch: 0, priority: 0, soon_met: 0 };
        return (
          <section aria-labelledby="mine" className="card mt-5 p-5">
            <h2 id="mine" className="font-bold">{v.company?.company_name ?? "우리 기업"} 맞춤 현황{!v.company && <span className="ml-2 text-xs font-normal text-[var(--muted)]">(이 브라우저에 저장한 정보 기준)</span>}</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Link href="/recommend?tab=priority" className="rounded-lg border border-green-200 bg-green-50 p-3 hover:underline"><span className="block text-xs text-green-900">우선 추천</span><span className="text-xl font-bold text-green-900">{c.priority}건</span></Link>
              <Link href="/recommend?tab=all" className="rounded-lg border border-amber-200 bg-amber-50 p-3 hover:underline"><span className="block text-xs text-amber-900">검토 가능 전체</span><span className="text-xl font-bold text-amber-900">{c.likely_met + c.needs_check - c.insufficient}건</span></Link>
              <Link href="/search?soon=1&met=1&sort=deadline" className="rounded-lg border border-red-200 bg-red-50 p-3 hover:underline"><span className="block text-xs text-red-900">조건 충족 중 마감 7일 이내</span><span className="text-xl font-bold text-red-900">{c.soon_met}건</span></Link>
            </div>
          </section>
        );
      })(v.profile)}

      {!v.profile && (
        <section className="card mt-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-bold">1분이면 우리 기업에 맞는 공고만 골라 드립니다</h2><p className="text-sm text-[var(--muted)]">로그인 없이 소재지·규모 등 아는 것만 입력하세요. 정보는 이 브라우저에만 저장됩니다.</p></div>
          <Link href="/recommend" className="btn shrink-0">우리 기업 맞춤 공고 보기</Link>
        </section>
      )}

      <nav aria-label="분야 바로가기" className="mt-5 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => <Link key={c.id} href={`/search?category=${c.id}`} className="btn btn-ghost">{c.name}</Link>)}
      </nav>

      <div className="mt-5 space-y-2">
        <Notice tone="warn">
          <strong>데이터 수집 범위:</strong>{" "}
          {meta?.live ? `연동된 실제 원천 ${meta.live}곳` : "현재 연동된 실제 공고 원천이 없습니다"}
          {meta?.mock ? " · 개발용 테스트(모의) 데이터가 포함되어 있습니다(‘테스트 데이터’ 표시)" : ""}. 공식 API 이용조건 확인 후 단계적으로 확대합니다.
          {" "}최종 갱신: {formatSeoul(meta?.last)} · 등록 공고 {meta?.total ?? 0}건
        </Notice>
      </div>
      {await section("접수 중 공고", "open", open, "/search?status=open&sort=latest")}
      {await section("마감 임박 (7일 이내)", "soon", soon, "/search?soon=1&sort=deadline")}
      {await section("신규 등록 공고", "new", fresh, "/search?sort=latest")}
      <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME} className="mt-8" />
      <p className="sr-only">{facets.organizations.length}개 기관</p>
    </>
  );
}
