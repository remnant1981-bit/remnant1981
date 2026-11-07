"use client";
import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="rounded border border-gray-500 px-3 py-2 text-sm"
        onClick={async () => { try { await navigator.clipboard.writeText(text); setMsg("복사했습니다."); } catch { setMsg("복사하지 못했습니다. 직접 선택해 복사하세요."); } }}>{label}</button>
      <span role="status" aria-live="polite" className="text-xs text-gray-700">{msg}</span>
    </span>
  );
}
