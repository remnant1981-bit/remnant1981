"use client";
import Link from "next/link";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";
import { clearRecent, removeFavorite, setRecentEnabled, useFavorites, useRecent, useRecentEnabled } from "@/lib/saved";

/** 홈: 즐겨찾는 주차장·최근 검색. 저장된 것이 없으면 아무것도 표시하지 않음 */
export function SavedPanel({ lang = "ko" }: { lang?: Lang }) {
  const t = dict(lang).saved;
  const favs = useFavorites(), recent = useRecent(), recentOn = useRecentEnabled();
  return (
    <div className="mt-8 space-y-6">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={recentOn} onChange={(e) => setRecentEnabled(e.target.checked)} />
        {t.recentToggle} <span className="text-xs text-gray-600">{t.recentToggleNote}</span>
      </label>
      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="recent-h" className="font-semibold">{t.recent}</h2>
            <button type="button" onClick={clearRecent} className="text-xs text-gray-700 underline">{t.clear}</button>
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
          <h2 id="fav-h" className="font-semibold">{t.favs}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {favs.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0"><Link href={`/lots/${f.id}`} className="underline">{f.name}</Link>{f.address && <span className="block truncate text-xs text-gray-600">{f.address}</span>}</span>
                <button type="button" onClick={() => removeFavorite(f.id)} className="shrink-0 text-xs text-gray-700 underline" aria-label={t.removeAria(f.name)}>{t.remove}</button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-600">{t.note}</p>
        </section>
      )}
    </div>
  );
}
