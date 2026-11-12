"use client";
import { useState } from "react";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";


export function CopyButton({ text, label, lang = "ko" }: { text: string; label: string; lang?: Lang }) {
  const t = dict(lang).copy;
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="rounded border border-gray-500 px-3 py-2 text-sm"
        onClick={async () => { try { await navigator.clipboard.writeText(text); setMsg(t.ok); } catch { setMsg(t.fail); } }}>{label}</button>
      <span role="status" aria-live="polite" className="text-xs text-gray-700">{msg}</span>
    </span>
  );
}
