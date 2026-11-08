"use client";
import { useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { readGuestMarks, serverGuestMarks, subscribeGuestMarks, toggleGuestMark } from "@/lib/guest-bookmarks";

type Meta = { title: string; organization: string; end: string | null };

/** 회원: 서버 저장. 게스트(guest): 이 브라우저에만 저장. */
export function BookmarkButton({ announcementId, initial, guest, meta }: { announcementId: string; initial: boolean; guest?: boolean; meta?: Meta }) {
  if (guest) return <GuestBookmark id={announcementId} meta={meta ?? { title: "", organization: "", end: null }} />;
  return <MemberBookmark announcementId={announcementId} initial={initial} />;
}

function MemberBookmark({ announcementId, initial }: { announcementId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function toggle() {
    setBusy(true); setErr("");
    const r = await api(on ? "DELETE" : "POST", "/api/bookmarks", { announcementId });
    if (r.ok) setOn(!on); else setErr("저장하지 못했습니다. 다시 시도해 주세요.");
    setBusy(false);
  }
  return (
    <span className="no-print">
      <button type="button" className="btn btn-ghost" aria-pressed={on} disabled={busy} onClick={toggle}>{on ? "★ 관심 공고 해제" : "☆ 관심 공고 저장"}</button>
      {err && <span role="alert" className="ml-2 text-sm text-red-700">{err}</span>}
    </span>
  );
}

function GuestBookmark({ id, meta }: { id: string; meta: Meta }) {
  const marks = useSyncExternalStore(subscribeGuestMarks, readGuestMarks, serverGuestMarks);
  const on = marks.some((x) => x.id === id);
  return (
    <span className="no-print">
      <button type="button" className="btn btn-ghost" aria-pressed={on} title="게스트 모드: 이 브라우저에만 저장"
        onClick={() => toggleGuestMark({ id, ...meta })}>{on ? "★ 관심 공고 해제" : "☆ 관심 공고 저장"}</button>
    </span>
  );
}
