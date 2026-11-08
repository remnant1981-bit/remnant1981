"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { setGuestCheck } from "@/lib/guest-checks";

export interface CheckItem { fieldKey: string; label: string; excerpt: string | null; userChecked?: "yes" | "no" }

/**
 * 공고별 조건 직접 확인: 원문을 보고 '해당함/해당 안 함'을 고르면 이 공고의 판정·정확도에 바로 반영.
 * 회원은 기업 계정에, 게스트는 이 브라우저에만 저장.
 */
export function ConditionCheck({ announcementId, items, member }: { announcementId: string; items: CheckItem[]; member: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (!items.length) return null;

  async function save(fieldKey: string, verdict: "yes" | "no" | "") {
    setBusy(fieldKey); setErr("");
    if (member) {
      const r = await api("POST", "/api/checks", { announcementId, fieldKey, verdict });
      if (!r.ok) { setBusy(""); setErr("저장하지 못했습니다."); return; }
    } else setGuestCheck(announcementId, fieldKey, verdict);
    setBusy("");
    router.refresh();
  }

  return (
    <div className="no-print mt-2 grid gap-1.5 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 text-sm">
      <p className="text-xs font-semibold text-blue-900">🎯 이 공고 정확도 높이기 — 공식 원문을 보고 선택하세요</p>
      {items.map((it) => {
        const id = `${uid}-${it.fieldKey}`;
        return (
          <div key={it.fieldKey} className="flex flex-wrap items-center gap-2">
            <label htmlFor={id} className="font-medium">{it.label}</label>
            {it.excerpt && <span className="text-xs text-[var(--muted)]">(근거: {it.excerpt.length > 40 ? it.excerpt.slice(0, 40) + "…" : it.excerpt})</span>}
            <select id={id} className="input !w-auto !py-1 text-sm" value={it.userChecked ?? ""} disabled={busy === it.fieldKey}
              onChange={(e) => save(it.fieldKey, e.target.value as "yes" | "no" | "")}>
              <option value="">{it.userChecked ? "확인 취소" : "원문 확인 결과 선택"}</option>
              <option value="yes">해당함</option>
              <option value="no">해당 안 함</option>
            </select>
            {busy === it.fieldKey && <span className="text-xs">반영 중…</span>}
            {it.userChecked && busy !== it.fieldKey && <span className="chip bg-blue-100 text-blue-900">직접 확인됨</span>}
          </div>
        );
      })}
      {err && <p role="alert" className="text-red-700">{err}</p>}
    </div>
  );
}
