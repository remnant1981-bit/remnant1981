"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { clearGuestMarks, readGuestMarks, serverGuestMarks, subscribeGuestMarks, toggleGuestMark } from "@/lib/guest-bookmarks";

/** 게스트 관심 공고 목록. member=true면 계정으로 옮기기 버튼만 표시(옮길 것이 있을 때). */
export function GuestMarks({ member = false }: { member?: boolean }) {
  const marks = useSyncExternalStore(subscribeGuestMarks, readGuestMarks, serverGuestMarks);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function importAll() {
    setBusy(true); setMsg("");
    let fail = 0;
    for (const m of marks) { const r = await api("POST", "/api/bookmarks", { announcementId: m.id }); if (!r.ok) fail++; }
    if (!fail) clearGuestMarks();
    setBusy(false); setMsg(fail ? `${fail}건을 옮기지 못했습니다(삭제된 공고일 수 있음).` : "계정으로 옮겼습니다.");
    router.refresh();
  }

  if (member) {
    if (!marks.length) return msg ? <p className="text-sm">{msg}</p> : null;
    return (
      <div className="card flex flex-wrap items-center gap-3 bg-[var(--brand-soft)] p-3 text-sm">
        <span>이 브라우저(게스트 모드)에 저장한 관심 공고 {marks.length}건이 있습니다.</span>
        <button type="button" className="btn" disabled={busy} onClick={importAll}>{busy ? "옮기는 중…" : "계정으로 옮기기"}</button>
        {msg && <span>{msg}</span>}
      </div>
    );
  }
  if (!marks.length) return <p className="card p-4 text-sm text-[var(--muted)]">저장한 관심 공고가 없습니다. 공고 카드의 ‘☆ 관심 공고 저장’을 누르면 여기에 모입니다.</p>;
  return (
    <ul className="grid gap-2">
      {marks.map((m) => (
        <li key={m.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><Link className="font-semibold underline" href={`/announcements/${m.id}`}>{m.title || "공고"}</Link>{m.organization && ` · ${m.organization}`} · 마감 {m.end ?? "확인 필요"}</span>
          <button type="button" className="btn btn-ghost !py-1 text-xs" onClick={() => toggleGuestMark(m)}>삭제</button>
        </li>
      ))}
    </ul>
  );
}
