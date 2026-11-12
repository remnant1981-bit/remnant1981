"use client";
import Link from "next/link";
import { clearRecent, removeFavorite, useFavorites, useRecent } from "@/lib/saved";

/** 홈: 즐겨찾는 주차장·최근 검색. 저장된 것이 없으면 아무것도 표시하지 않음 */
export function SavedPanel() {
  const favs = useFavorites(), recent = useRecent();
  if (favs.length === 0 && recent.length === 0) return null;
  return (
    <div className="mt-8 space-y-6">
      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="recent-h" className="font-semibold">최근 검색</h2>
            <button type="button" onClick={clearRecent} className="text-xs text-gray-700 underline">기록 지우기</button>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {recent.map((r) => (
              <li key={r.query}><Link href={`/search?${r.query}`} className="underline">{r.label}</Link> <span className="text-xs text-gray-600">{r.period}</span></li>
            ))}
          </ul>
        </section>
      )}
      {favs.length > 0 && (
        <section aria-labelledby="fav-h">
          <h2 id="fav-h" className="font-semibold">즐겨찾는 주차장</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {favs.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0"><Link href={`/lots/${f.id}`} className="underline">{f.name}</Link>{f.address && <span className="block truncate text-xs text-gray-600">{f.address}</span>}</span>
                <button type="button" onClick={() => removeFavorite(f.id)} className="shrink-0 text-xs text-gray-700 underline" aria-label={`${f.name} 즐겨찾기 해제`}>삭제</button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-600">즐겨찾기·최근 검색은 이 기기의 브라우저에만 저장되며 서버로 보내지 않습니다.</p>
        </section>
      )}
    </div>
  );
}
