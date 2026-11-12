"use client";
import { useState, useSyncExternalStore } from "react";
import type { NaverLinks, NaverLinkSet } from "@/domain/map-link";
import { NAVER_MAP_APPSTORE_URL, NAVER_MAP_PLAY_URL } from "@/domain/map-link";
import { CopyButton } from "./CopyButton";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";


type Platform = "android" | "ios" | "other";
const subscribe = () => () => {};
const platform = (): Platform => {
  const ua = navigator.userAgent;
  return /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : "other";
};
const serverPlatform = (): Platform => "other";

export function MapLinks({ links, addressText, coordText, lang = "ko" }: { links: NaverLinks; addressText: string; coordText: string | null; lang?: Lang }) {
  const t = dict(lang).links;
  const p = useSyncExternalStore(subscribe, platform, serverPlatform);
  const [failed, setFailed] = useState(false);

  // iOS: 앱 미설치 시 조용히 실패하므로 일정 시간 후에도 화면이 그대로면 대체 수단(앱스토어·복사)을 보여 준다
  const openIos = (scheme: string) => {
    setFailed(false);
    const t = window.setTimeout(() => { if (!document.hidden) setFailed(true); }, 1800);
    document.addEventListener("visibilitychange", () => window.clearTimeout(t), { once: true });
    window.location.assign(scheme);
  };

  const anchor = (set: NaverLinkSet | null, label: string) => {
    if (!set) return null;
    const cls = "inline-block rounded bg-green-700 px-3 py-2 text-sm font-semibold text-white";
    if (p === "android") return <a className={cls} href={set.androidIntent}>{label}</a>; // 미설치 시 Play 스토어로 이동(Intent URL)
    if (p === "ios") return <button type="button" className={cls} onClick={() => openIos(set.scheme)}>{label}</button>;
    return <button type="button" className={cls + " opacity-60"} disabled aria-disabled="true">{label}</button>;
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {anchor(links.car, t.car)}
        {anchor(links.walk, t.walk)}
        {anchor(links.place, t.place)}
      </div>
      {p === "other" && <p className="text-xs text-gray-700">{t.desktop}</p>}
      {!links.walk && <p className="text-xs text-gray-600">{t.walkNote}</p>}
      {failed && (
        <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-xs">
          {t.failed1}<a className="underline" href={NAVER_MAP_APPSTORE_URL}>{t.failedLink}</a>{t.failed2}
        </p>
      )}
      {p === "android" && <p className="text-xs text-gray-600">{t.play1}<a className="underline" href={NAVER_MAP_PLAY_URL}>{t.playLink}</a>{t.play2}</p>}
      <div className="flex flex-wrap gap-2">
        {addressText && <CopyButton lang={lang} text={addressText} label={t.copyAddr} />}
        {coordText && <CopyButton lang={lang} text={coordText} label={t.copyCoord} />}
      </div>
    </div>
  );
}
