"use client";
import type { Lang } from "@/i18n";

/** 언어 전환 링크. JS가 있으면 지금 화면으로 돌아오고, 없으면 홈으로 돌아온다 */
export function LangSwitch({ to, label, aria }: { to: Lang; label: string; aria: string }) {
  return (
    <a href={`/lang?to=${to}`} lang={to} hrefLang={to} aria-label={`${aria}: ${label}`} className="rounded border border-gray-400 px-2 py-1 text-xs text-gray-800"
      onClick={(e) => { e.currentTarget.href = `/lang?to=${to}&next=${encodeURIComponent(window.location.pathname + window.location.search)}`; }}>
      {label}
    </a>
  );
}
