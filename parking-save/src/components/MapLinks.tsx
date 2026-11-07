"use client";
import { useState, useSyncExternalStore } from "react";
import type { NaverLinks, NaverLinkSet } from "@/domain/map-link";
import { NAVER_MAP_APPSTORE_URL, NAVER_MAP_PLAY_URL } from "@/domain/map-link";
import { CopyButton } from "./CopyButton";

type Platform = "android" | "ios" | "other";
const subscribe = () => () => {};
const platform = (): Platform => {
  const ua = navigator.userAgent;
  return /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : "other";
};
const serverPlatform = (): Platform => "other";

export function MapLinks({ links, addressText, coordText }: { links: NaverLinks; addressText: string; coordText: string | null }) {
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
        {anchor(links.car, "네이버 지도로 길찾기 (자동차)")}
        {anchor(links.walk, "주차 후 목적지까지 도보 길찾기")}
        {anchor(links.place, "네이버 지도에서 위치 보기")}
      </div>
      {p === "other" && <p className="text-xs text-gray-700">네이버 지도 앱 호출은 휴대폰(Android·iOS)에서만 동작합니다. 아래 주소·좌표를 복사해 사용하세요.</p>}
      {!links.walk && <p className="text-xs text-gray-600">도보 길찾기는 &lsquo;목적지&rsquo;로 검색한 경우에만 제공됩니다.</p>}
      {failed && (
        <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-xs">
          네이버 지도 앱이 열리지 않았습니다. 앱이 설치되어 있지 않다면 <a className="underline" href={NAVER_MAP_APPSTORE_URL}>앱스토어에서 설치</a>하거나, 주소·좌표를 복사해 사용하세요.
        </p>
      )}
      {p === "android" && <p className="text-xs text-gray-600">앱이 없으면 Google Play로 이동합니다. (<a className="underline" href={NAVER_MAP_PLAY_URL}>직접 열기</a>)</p>}
      <div className="flex flex-wrap gap-2">
        {addressText && <CopyButton text={addressText} label="주소 복사" />}
        {coordText && <CopyButton text={coordText} label="좌표 복사" />}
      </div>
    </div>
  );
}
