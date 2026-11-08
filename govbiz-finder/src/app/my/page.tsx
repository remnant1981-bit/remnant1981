import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { getNotificationSettings, listBookmarks, listHistory, listNotifications } from "@/server/userdata";
import { Notice, PageTitle, Empty, DeadlineChip } from "@/components/ui";
import { deadlineDays } from "@/domain/status";
import { seoulToday } from "@/lib/time";

/** 접수 중이고 마감이 가까운 순 → 마감일 미정 → 마감된 공고 */
function sortByDeadline<T extends { application_end: string | null; application_status: string }>(xs: T[]): T[] {
  const rank = (x: T) => (x.application_status === "closed" ? 2 : x.application_end ? 0 : 1);
  return [...xs].sort((a, b) => rank(a) - rank(b) || String(a.application_end ?? "").localeCompare(String(b.application_end ?? "")));
}
import { NotificationSettings } from "@/components/NotificationSettings";
import { MyActions } from "@/components/MyActions";
import { GuestMarks } from "@/components/GuestMarks";
import { formatSeoul } from "@/lib/time";

export const metadata: Metadata = { title: "내 공고·알림", robots: { index: false, follow: false } };

export default async function Page() {
  const v = await getViewer();
  if (!v.session || !v.company) return (
    <div className="grid gap-6">
      <PageTitle sub="로그인 없이 사용 중 · 정보는 이 브라우저에만 저장됩니다">내 관심 공고 <span className="chip ml-2 align-middle bg-gray-100 text-gray-800">게스트 모드</span></PageTitle>
      {v.session
        ? <Notice tone="warn">기업 관계 확인이 완료되면 관심 공고·이력·알림이 계정에 저장됩니다. 그 전까지는 게스트 모드로 이 브라우저에 저장됩니다. <Link className="underline" href="/company">기업정보로 이동</Link></Notice>
        : <Notice>게스트 모드에서도 검색·맞춤 공고·정확도 높이기·관심 공고 저장을 모두 쓸 수 있습니다. <strong>다른 기기에서 보기, 검색·열람 이력, 새 공고·마감 알림</strong>이 필요하면 <Link className="underline" href="/register">회원가입</Link>하세요(저장한 내용은 가입 후 옮길 수 있음).</Notice>}
      <section aria-labelledby="gb"><h2 id="gb" className="mb-2 font-bold">관심 공고</h2><GuestMarks /></section>
      <section aria-labelledby="gp"><h2 id="gp" className="mb-2 font-bold">맞춤 정보</h2>
        <p className="card p-4 text-sm">{v.guestProfile ? <>이 브라우저에 기업정보 {Object.keys(v.guestProfile).length}개 항목이 저장되어 있습니다. <Link className="underline" href="/recommend">우리 기업 공고 보기</Link></> : <>아직 입력한 기업정보가 없습니다. <Link className="underline" href="/recommend">맞춤 공고 시작하기</Link></>}</p>
      </section>
    </div>
  );
  const db = await getDb();
  const uid = v.session.user.id;
  const today = seoulToday();
  const [marks, hist, notifs, settings] = await Promise.all([listBookmarks(db, uid) as Promise<any[]>, listHistory(db, uid), listNotifications(db, uid), getNotificationSettings(db, uid)]);
  return (
    <div className="grid gap-8">
      <PageTitle sub={`${v.company.company_name ?? "내 기업"} (${v.company.business_number_masked})`}>내 공고·알림</PageTitle>
      <section aria-labelledby="n"><div className="mb-2 flex items-center justify-between"><h2 id="n" className="font-bold">알림</h2><MyActions kind="read" /></div>
        {notifs.length === 0 ? <Empty title="알림이 없습니다." /> : <ul className="grid gap-2">{notifs.map((n) => (
          <li key={n.id} className={`card p-3 text-sm ${n.status === "unread" ? "border-[var(--brand)]" : ""}`}>
            <strong>{n.type === "new_announcement" ? "신규 공고" : n.type === "deadline_soon" ? "마감 임박" : "관심 공고 변경"}</strong>{" · "}
            <Link className="underline" href={`/announcements/${String(n.payload.announcementId)}`}>{String(n.payload.title)}</Link>
            {typeof n.payload.dDay === "number" && ` (D-${n.payload.dDay})`} <span className="text-[var(--muted)]">{formatSeoul(n.scheduled_at)}</span>
          </li>))}</ul>}
      </section>
      <section aria-labelledby="s"><h2 id="s" className="mb-2 font-bold">알림 설정</h2><NotificationSettings initial={settings} emailAvailable={!!process.env.EMAIL_PROVIDER} /></section>
      <section aria-labelledby="b"><h2 id="b" className="mb-2 font-bold">관심 공고</h2>
        <div className="mb-2"><GuestMarks member /></div>
        {marks.length === 0 ? <Empty title="저장한 관심 공고가 없습니다." /> : <ul className="grid gap-2">{sortByDeadline(marks).map((m) => {
          const d = m.application_status === "open" ? deadlineDays(m.application_end, today) : null;
          const hot = d !== null && d >= 0 && d <= 7;
          return (
          <li key={m.id} className={`card flex flex-wrap items-center gap-2 p-3 text-sm`} style={hot ? { background: d! <= 3 ? "#fef2f2" : "#fff7ed", borderColor: d! <= 3 ? "#f87171" : "#fdba74" } : undefined}>
            <DeadlineChip d={hot ? d : null} />
            <Link className="font-semibold underline" href={`/announcements/${m.id}`}>{m.title}</Link><span>· {m.organization} · 마감 {m.application_end ?? "확인 필요"}</span>
            {m.application_status === "closed" && <span className="chip bg-gray-100 text-gray-600">마감됨</span>}
          </li>); })}</ul>}
      </section>
      <section aria-labelledby="h"><div className="mb-2 flex items-center justify-between"><h2 id="h" className="font-bold">검색·열람 이력</h2><MyActions kind="clear" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">최근 검색</h3>{hist.searches.length === 0 ? "없음" : <ul className="grid gap-1">{hist.searches.map((s) => {
            const q = JSON.parse(s.query_json) as Record<string, string | string[]>;
            const u = new URLSearchParams(); for (const [k, val] of Object.entries(q)) if (val && !(Array.isArray(val) && !val.length)) u.set(k, Array.isArray(val) ? val.join(",") : String(val));
            return <li key={s.id}><Link className="underline" href={`/search?${u}`}>{String(q.q || "(검색어 없음)")}</Link> <span className="text-[var(--muted)]">{formatSeoul(s.created_at)}</span></li>; })}</ul>}</div>
          <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">최근 열람</h3>{hist.views.length === 0 ? "없음" : <ul className="grid gap-1">{(hist.views as any[]).map((x) => <li key={x.id}><Link className="underline" href={`/announcements/${x.announcement_id}`}>{x.title}</Link> <span className="text-[var(--muted)]">{formatSeoul(x.viewed_at)}</span></li>)}</ul>}</div>
        </div>
      </section>
    </div>
  );
}
