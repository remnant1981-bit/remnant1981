"use client";
import { useState } from "react";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";


/** 정보 오류 신고(관리자 검토 후 반영). 이름·연락처는 받지 않음 */
export function ReportForm({ lotId, lang = "ko" }: { lotId: number; lang?: Lang }) {
  const t = dict(lang).report;
  const [cat, setCat] = useState("");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; text?: string }>({ kind: "idle" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cat) { setState({ kind: "error", text: t.pick }); return; }
    setState({ kind: "sending" });
    try {
      const res = await fetch(`/api/parking-lots/${lotId}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: cat, message: msg }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setState({ kind: "done", text: j.duplicate ? t.dup : t.ok });
      else setState({ kind: "error", text: (lang === "ko" ? j?.error?.message : null) ?? t.fail });
    } catch { setState({ kind: "error", text: t.net }); }
  };
  return (
    <details className="mt-4 rounded border border-gray-300 p-3">
      <summary className="cursor-pointer font-semibold">{t.summary}</summary>
      {state.kind === "done" ? <p role="status" className="mt-2 text-sm">{state.text}</p> : (
        <form onSubmit={submit} className="mt-2 space-y-2" aria-label={t.aria}>
          <fieldset className="space-y-1"><legend className="text-sm">{t.what}</legend>
            {t.cats.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="report-cat" value={v} checked={cat === v} onChange={() => setCat(v)} /> {l}</label>)}
          </fieldset>
          <label htmlFor={`report-msg-${lotId}`} className="block text-sm">{t.detail}</label>
          <textarea id={`report-msg-${lotId}`} maxLength={500} rows={3} value={msg} onChange={(e) => setMsg(e.target.value)}
            className="w-full rounded border border-gray-400 bg-white px-2 py-1 text-sm" placeholder={t.placeholder} />
          <p className="text-xs text-gray-600">{t.privacy}</p>
          <button type="submit" disabled={state.kind === "sending"} className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white">{state.kind === "sending" ? t.sending : t.send}</button>
          {state.kind === "error" && <p role="alert" className="text-sm text-red-900">{state.text}</p>}
        </form>
      )}
    </details>
  );
}
