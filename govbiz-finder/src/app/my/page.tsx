import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { getNotificationSettings, listBookmarks, listHistory, listNotifications } from "@/server/userdata";
import { Notice, PageTitle, Empty } from "@/components/ui";
import { NotificationSettings } from "@/components/NotificationSettings";
import { MyActions } from "@/components/MyActions";
import { formatSeoul } from "@/lib/time";

export const metadata: Metadata = { title: "내 공고·알림", robots: { index: false, follow: false } };

export default async function Page() {
  const v = await getViewer();
  if (!v.session) redirect("/login");
  if (!v.company) return (<><PageTitle>내 공고·알림</PageTitle><Notice tone="warn">관심 공고·이력·알림은 기업 관계 확인이 완료된 후 이용할 수 있습니다. <Link className="underline" href="/company">기업정보로 이동</Link></Notice></>);
  const db = await getDb();
  const uid = v.session.user.id;
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
        {marks.length === 0 ? <Empty title="저장한 관심 공고가 없습니다." /> : <ul className="grid gap-2">{marks.map((m) => (
          <li key={m.id} className="card p-3 text-sm"><Link className="font-semibold underline" href={`/announcements/${m.id}`}>{m.title}</Link> · {m.organization} · 마감 {m.application_end ?? "확인 필요"}</li>))}</ul>}
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
