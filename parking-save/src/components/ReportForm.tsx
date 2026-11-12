"use client";
import { useState } from "react";

const CATS: Array<[string, string]> = [["FEE", "요금이 달라요"], ["HOURS", "운영시간이 달라요"], ["LOCATION", "위치·주소가 달라요"], ["CLOSED", "폐쇄됐어요/공사 중"], ["OTHER", "기타"]];

/** 정보 오류 신고(관리자 검토 후 반영). 이름·연락처는 받지 않음 */
export function ReportForm({ lotId }: { lotId: number }) {
  const [cat, setCat] = useState("");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; text?: string }>({ kind: "idle" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cat) { setState({ kind: "error", text: "신고 유형을 선택하세요." }); return; }
    setState({ kind: "sending" });
    try {
      const res = await fetch(`/api/parking-lots/${lotId}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: cat, message: msg }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setState({ kind: "done", text: j.duplicate ? "이미 같은 신고가 접수되어 있습니다. 감사합니다." : "신고가 접수되었습니다. 확인 후 반영하겠습니다." });
      else setState({ kind: "error", text: j?.error?.message ?? "신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } catch { setState({ kind: "error", text: "네트워크 오류로 보내지 못했습니다." }); }
  };
  return (
    <details className="mt-4 rounded border border-gray-300 p-3">
      <summary className="cursor-pointer font-semibold">정보가 틀렸나요? 알려 주세요</summary>
      {state.kind === "done" ? <p role="status" className="mt-2 text-sm">{state.text}</p> : (
        <form onSubmit={submit} className="mt-2 space-y-2" aria-label="정보 오류 신고">
          <fieldset className="space-y-1"><legend className="text-sm">무엇이 다른가요?</legend>
            {CATS.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="report-cat" value={v} checked={cat === v} onChange={() => setCat(v)} /> {l}</label>)}
          </fieldset>
          <label htmlFor={`report-msg-${lotId}`} className="block text-sm">자세한 내용(선택, 500자 이내)</label>
          <textarea id={`report-msg-${lotId}`} maxLength={500} rows={3} value={msg} onChange={(e) => setMsg(e.target.value)}
            className="w-full rounded border border-gray-400 bg-white px-2 py-1 text-sm" placeholder="예: 평일 요금이 30분 1,000원으로 바뀌었습니다" />
          <p className="text-xs text-gray-600">이름·연락처 등 개인정보는 적지 마세요. 신고 내용은 관리자가 확인한 뒤 반영하며 바로 바뀌지 않습니다.</p>
          <button type="submit" disabled={state.kind === "sending"} className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white">{state.kind === "sending" ? "보내는 중…" : "신고 보내기"}</button>
          {state.kind === "error" && <p role="alert" className="text-sm text-red-900">{state.text}</p>}
        </form>
      )}
    </details>
  );
}
