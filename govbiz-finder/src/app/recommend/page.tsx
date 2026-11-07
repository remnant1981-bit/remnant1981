import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { parseSearchParams } from "@/domain/search";
import { searchWithMatches, saveMatches } from "@/server/recommend";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { RecommendPanel } from "@/components/RecommendPanel";
import { Empty, Notice, PageTitle } from "@/components/ui";
import { bookmarkedIds } from "@/server/userdata";

export const metadata: Metadata = { title: "맞춤 추천", alternates: { canonical: "/recommend" } };

export default async function Page() {
  const v = await getViewer();
  if (v.company && v.session) {
    const db = await getDb();
    const res = await searchWithMatches(db, parseSearchParams({ sort: "fit", size: "30", status: "open,upcoming,always,unknown" }), v.company);
    await saveMatches(db, v.company.id, res.rows);
    const marks = await bookmarkedIds(db, v.session.user.id, v.company.id);
    return (
      <>
        <PageTitle sub="입력된 기업정보만으로 판단하며, 미입력 항목은 ‘확인 필요’입니다.">맞춤 추천</PageTitle>
        <Notice>추천은 참고정보입니다. 최종 신청 자격은 공식 원문과 담당기관 확인이 기준입니다.</Notice>
        <div className="mt-4 grid gap-3">
          {res.rows.length ? res.rows.map((r) => <AnnouncementCard key={r.id} r={r} canBookmark bookmarked={marks.has(r.id)} />) : <Empty title="추천할 공고가 없습니다." />}
        </div>
      </>
    );
  }
  return (
    <>
      <PageTitle sub="기업정보 입력은 선택입니다. 입력한 항목만으로 추천합니다.">맞춤 추천</PageTitle>
      {v.session && v.membership !== "verified" && <div className="mb-4"><Notice tone="warn">기업 관계 확인이 완료되지 않았습니다. 아래 체험은 저장되지 않습니다. <Link className="underline" href="/company">기업 관계 확인 진행</Link></Notice></div>}
      <RecommendPanel />
    </>
  );
}
