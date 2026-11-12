"use client";
import { useState } from "react";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";


/**
 * 현재 화면 링크 공유. 현재 위치 검색이면 좌표를 소수 3자리(약 100m)로 줄여 정확한 위치가 드러나지 않게 한다.
 * 기기 공유 시트(navigator.share)가 있으면 사용하고, 없으면 링크를 복사한다.
 */
export function shareUrl(href: string): string {
  const u = new URL(href);
  for (const k of ["lat", "lng"]) { const v = Number(u.searchParams.get(k)); if (u.searchParams.has(k) && Number.isFinite(v)) u.searchParams.set(k, v.toFixed(3)); }
  return u.toString();
}

export function ShareButton({ title, lang = "ko" }: { title: string; lang?: Lang }) {
  const t = dict(lang).share;
  const [msg, setMsg] = useState("");
  const onClick = async () => {
    const url = shareUrl(window.location.href);
    const coarse = new URL(window.location.href).searchParams.has("lat");
    try {
      if (navigator.share) { await navigator.share({ title, url }); setMsg(""); return; }
    } catch (e) { if ((e as Error)?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); setMsg(coarse ? t.copiedCoarse : t.copied); }
    catch { setMsg(t.fail); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={onClick} className="rounded border border-gray-500 px-3 py-1.5 text-sm">{t.button}</button>
      <span role="status" aria-live="polite" className="text-xs text-gray-700">{msg}</span>
    </span>
  );
}
