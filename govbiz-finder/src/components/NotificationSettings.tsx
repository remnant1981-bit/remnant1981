"use client";
import { useState } from "react";
import { api } from "@/lib/client";

type S = { type: string; enabled: boolean; channel: string; deadlineDays: number };
const LABEL: Record<string, string> = { new_announcement: "신규 공고 (내 기업정보에 맞는 공고)", deadline_soon: "마감 임박 (관심 공고)", bookmark_changed: "관심 공고 변경" };

export function NotificationSettings({ initial, emailAvailable }: { initial: S[]; emailAvailable: boolean }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  async function update(t: S, patch: Partial<S>) {
    const next = { ...t, ...patch };
    const r = await api<any>("PUT", "/api/notifications/settings", next);
    if (r.ok) { setS(r.data.settings); setMsg("저장했습니다."); } else setMsg(r.data.message ?? "저장하지 못했습니다.");
  }
  return (
    <div className="grid gap-3">
      {s.map((t) => (
        <div key={t.type} className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--line)] p-3 text-sm">
          <label className="inline-flex items-center gap-2 font-semibold"><input type="checkbox" checked={t.enabled} onChange={(e) => update(t, { enabled: e.target.checked })} /> {LABEL[t.type]}</label>
          <label className="inline-flex items-center gap-1">채널
            <select className="input !w-auto" value={t.channel} onChange={(e) => update(t, { channel: e.target.value })}>
              <option value="in_app">앱 내 알림</option>
              <option value="email" disabled={!emailAvailable}>이메일{emailAvailable ? "" : " (공급자 설정 전)"}</option>
            </select></label>
          {t.type === "deadline_soon" && <label className="inline-flex items-center gap-1">마감 <input type="number" min={1} max={30} className="input !w-20" value={t.deadlineDays} onChange={(e) => update(t, { deadlineDays: Number(e.target.value) })} />일 전</label>}
        </div>
      ))}
      <p role="status" className="text-sm text-[var(--muted)]">{msg || "알림은 언제든 해제할 수 있습니다. 이메일·카카오·SMS 발송은 공급자 설정 및 동의 후 활성화됩니다(현재 앱 내 알림만 지원)."}</p>
    </div>
  );
}
