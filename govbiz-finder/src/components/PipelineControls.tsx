"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { STAGES } from "@/domain/pipeline";

type Member = { id: string; email: string };

/** 진행 단계 선택(카드·목록용). 값이 없으면 '진행 관리에 추가' 상태. */
export function StageSelect({ announcementId, stage, compact }: { announcementId: string; stage: string | null; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function change(v: string) {
    setBusy(true); setErr("");
    const r = v === "" ? await api("DELETE", "/api/pipeline", { announcementId })
      : await api("POST", "/api/pipeline", { announcementId, stage: v });
    setBusy(false);
    if (r.ok) router.refresh(); else setErr("저장하지 못했습니다.");
  }
  return (
    <span className="no-print inline-flex items-center gap-1">
      <select aria-label="신청 진행 단계" className={`input !w-auto ${compact ? "!min-h-0 !py-1 text-sm" : ""}`} value={stage ?? ""} disabled={busy}
        onChange={(e) => { if (e.target.value === "" && !confirm("진행 관리에서 빼면 이 공고의 메모도 삭제됩니다. 뺄까요?")) return; change(e.target.value); }}>
        <option value="">{stage ? "진행 관리에서 빼기" : "＋ 진행 관리에 추가"}</option>
        {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

/** 공고 상세의 진행 관리 패널: 단계·담당자·목표일·메모 */
export function PipelinePanel({ announcementId, item, members, me }: {
  announcementId: string; me: string; members: Member[];
  item: { stage: string; assignee_user_id: string | null; target_date: string | null; notes: { id: string; body: string; created_at: string; author: string | null }[] } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  async function patch(body: Record<string, unknown>) {
    setBusy(true); setErr("");
    const r = await api<any>("POST", "/api/pipeline", { announcementId, ...body });
    setBusy(false);
    if (r.ok) router.refresh(); else setErr(r.data?.message ?? "저장하지 못했습니다.");
  }
  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true); setErr("");
    const r = await api<any>("POST", "/api/pipeline/notes", { announcementId, body: note });
    setBusy(false);
    if (r.ok) { setNote(""); router.refresh(); } else setErr(r.data?.message ?? "저장하지 못했습니다.");
  }
  return (
    <section aria-labelledby="pl" className="no-print card grid gap-3 p-4">
      <h2 id="pl" className="font-bold">신청 진행 관리 <span className="text-xs font-normal text-[var(--muted)]">우리 기업 구성원이 함께 봅니다</span></h2>
      <div className="flex flex-wrap items-end gap-3">
        <div><span className="label">진행 단계</span><StageSelect announcementId={announcementId} stage={item?.stage ?? null} /></div>
        {item && (
          <>
            <div><label htmlFor="pl-target" className="label">내부 목표일</label>
              <input id="pl-target" type="date" className="input !w-auto" defaultValue={item.target_date ?? ""} disabled={busy} onChange={(e) => patch({ targetDate: e.target.value })} /></div>
            {members.length > 1 && (
              <div><label htmlFor="pl-assignee" className="label">담당자</label>
                <select id="pl-assignee" className="input !w-auto" value={item.assignee_user_id ?? ""} disabled={busy} onChange={(e) => patch({ assigneeUserId: e.target.value })}>
                  <option value="">미지정</option>{members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                </select></div>
            )}
          </>
        )}
      </div>
      <form onSubmit={addNote} className="grid gap-2">
        <label htmlFor="pl-note" className="label">메모 {item ? `(${item.notes.length})` : ""}</label>
        <textarea id="pl-note" className="input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 담당기관 문의 결과, 준비할 서류, 내부 결정 사항" />
        <button className="btn w-fit" disabled={busy || !note.trim()}>메모 남기기</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      {item && item.notes.length > 0 && (
        <ul className="grid gap-2">
          {item.notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-[var(--line)] p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                <span>{n.author ?? "탈퇴한 사용자"} · {new Date(n.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
                {n.author === me && <button type="button" className="shrink-0 whitespace-nowrap underline" onClick={async () => { if (confirm("메모를 삭제할까요?")) { await api("DELETE", "/api/pipeline/notes", { noteId: n.id }); router.refresh(); } }}>삭제</button>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
