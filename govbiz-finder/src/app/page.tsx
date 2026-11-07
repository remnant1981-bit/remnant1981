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
  const section = async (title: string, id: string, res: typeof open, more: string) => {
    const rows = await attachMatches(db, res.rows, v.company);
    return (
      <section aria-labelledby={id} className="mt-8">
        <div className="mb-2 flex items-baseline justify-between"><h2 id={id} className="text-lg font-bold">{title}</h2><Link href={more} className="text-sm underline">더 보기</Link></div>
        {rows.length ? <div className="grid gap-3">{rows.map((r) => <AnnouncementCard key={r.id} r={r} canBookmark={false} />)}</div> : <Empty title="해당하는 공고가 없습니다." />}
      </section>
    );
  };
  return (
    <>
      <section className="rounded-2xl bg-[var(--brand)] px-6 py-10 text-white">
        <p className="text-sm opacity-90">몰라서 놓치는 지원사업이 없도록</p>
        <h1 className="mt-1 text-3xl font-extrabold leading-tight">기업지원사업, 한 번에 찾고<br className="sm:hidden" /> 공식 원문으로 확인하세요</h1>
        <p className="mt-3 text-sm opacity-90">회원가입 없이 검색할 수 있습니다. 기업정보 입력은 선택사항입니다.</p>
      </section>
      <div className="-mt-6 px-2"><SearchForm p={{}} compact /></div>

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
      {await section("접수 중 공고", "open", open, "/search?status=open")}
      {await section("마감 임박 (7일 이내)", "soon", soon, "/search?soon=1&sort=deadline")}
      {await section("신규 등록 공고", "new", fresh, "/search?sort=latest")}
      <p className="sr-only">{facets.organizations.length}개 기관</p>
    </>
  );
}
