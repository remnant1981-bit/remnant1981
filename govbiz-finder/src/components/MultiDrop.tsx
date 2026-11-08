"use client";
import { useState } from "react";

/** 다중선택 드롭다운(체크박스 목록). 폼 제출 시 같은 name 으로 여러 값 전달 */
export function MultiDrop({ name, label, items, v, hint }: { name: string; label: string; items: readonly (readonly [string, string])[]; v?: string | null; hint?: string }) {
  const [sel, setSel] = useState<string[]>((v ?? "").split(",").filter(Boolean));
  const names = items.filter(([k]) => sel.includes(k)).map(([, t]) => t);
  return (
    <div>
      <span className="label">{label}</span>
      <details className="relative">
        <summary className="no-caret input flex cursor-pointer list-none items-center justify-between gap-2 text-left [&::-webkit-details-marker]:hidden [&::marker]:content-none" style={{ backgroundImage: "none", display: "flex" }}>
          <span className={`min-w-0 flex-1 truncate ${names.length ? "" : "text-[var(--muted)]"}`}>{names.length ? names.join(", ") : "선택(복수 가능)"}</span>
          <span aria-hidden className="text-xs">▼</span>
        </summary>
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--line)] bg-white p-2 shadow-lg">
          {items.map(([k, t]) => (
            <label key={k} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" name={name} value={k} checked={sel.includes(k)}
                onChange={(e) => setSel((s) => (e.target.checked ? [...s, k] : s.filter((x) => x !== k)))} /> {t}
            </label>
          ))}
          {sel.length > 0 && <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-[var(--muted)] hover:bg-slate-50" onClick={() => setSel([])}>선택 모두 해제</button>}
        </div>
      </details>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}
