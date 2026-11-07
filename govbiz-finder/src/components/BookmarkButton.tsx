"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export function BookmarkButton({ announcementId, initial }: { announcementId: string; initial: boolean }) {
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
