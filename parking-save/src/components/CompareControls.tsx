"use client";
import Link from "next/link";
import { useState } from "react";
import { MAX_COMPARE, clearCompare, toggleCompare, useCompare } from "@/lib/compare";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";


/** 카드의 '비교에 담기' 토글 */
export function CompareToggle({ id, name, lang = "ko" }: { id: number; name: string; lang?: Lang }) {
  const t = dict(lang).compareUi;
  const list = useCompare();
  const [full, setFull] = useState(false);
  const on = list.some((x) => x.id === id);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" aria-pressed={on} onClick={() => setFull(!toggleCompare({ id, name }))}
        className={`shrink-0 rounded border px-2 py-1 text-xs ${on ? "border-blue-700 bg-blue-50 text-gray-900" : "border-gray-400 text-gray-700"}`}>
        {t.toggle}<span className="sr-only" lang="ko"> {name}</span>
      </button>
      {full && !on && <span role="status" className="text-xs text-amber-800">{t.full(MAX_COMPARE)}</span>}
    </span>
  );
}

/** 검색 화면 하단: 담은 시설과 비교 화면 이동 */
export function CompareTray({ query, lang = "ko" }: { query: string; lang?: Lang }) {
  const t = dict(lang).compareUi;
  const list = useCompare();
  if (list.length === 0) return null;
  const href = `/compare?ids=${list.map((x) => x.id).join(",")}&${query}`;
  return (
    <div className="sticky bottom-0 z-[1000] mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-300 bg-blue-50 p-3 text-sm" role="region" aria-label={t.tray}>
      <span>{t.trayList(list.map((x) => x.name).join(", "), list.length, MAX_COMPARE)}</span>
      <span className="flex gap-2">
        <button type="button" onClick={clearCompare} className="rounded border border-gray-500 px-2 py-1">{t.clear}</button>
        {list.length >= 2 ? <Link href={href} className="rounded bg-blue-700 px-3 py-1 font-semibold text-white">{t.go}</Link> : <span className="px-2 py-1 text-gray-700">{t.oneMore}</span>}
      </span>
    </div>
  );
}
