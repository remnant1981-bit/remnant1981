"use client";
import Link from "next/link";
import { useState } from "react";
import { MAX_COMPARE, clearCompare, toggleCompare, useCompare } from "@/lib/compare";

/** 카드의 '비교에 담기' 토글 */
export function CompareToggle({ id, name }: { id: number; name: string }) {
  const list = useCompare();
  const [full, setFull] = useState(false);
  const on = list.some((x) => x.id === id);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" aria-pressed={on} onClick={() => setFull(!toggleCompare({ id, name }))}
        className={`shrink-0 rounded border px-2 py-1 text-xs ${on ? "border-blue-700 bg-blue-50 text-gray-900" : "border-gray-400 text-gray-700"}`}>
        비교<span className="sr-only"> {name}</span>
      </button>
      {full && !on && <span role="status" className="text-xs text-amber-800">최대 {MAX_COMPARE}곳까지</span>}
    </span>
  );
}

/** 검색 화면 하단: 담은 시설과 비교 화면 이동 */
export function CompareTray({ query }: { query: string }) {
  const list = useCompare();
  if (list.length === 0) return null;
  const href = `/compare?ids=${list.map((x) => x.id).join(",")}&${query}`;
  return (
    <div className="sticky bottom-0 z-[1000] mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-300 bg-blue-50 p-3 text-sm" role="region" aria-label="비교할 주차장">
      <span>비교: {list.map((x) => x.name).join(", ")} ({list.length}/{MAX_COMPARE})</span>
      <span className="flex gap-2">
        <button type="button" onClick={clearCompare} className="rounded border border-gray-500 px-2 py-1">비우기</button>
        {list.length >= 2 ? <Link href={href} className="rounded bg-blue-700 px-3 py-1 font-semibold text-white">나란히 비교</Link> : <span className="px-2 py-1 text-gray-700">1곳 더 담으세요</span>}
      </span>
    </div>
  );
}
