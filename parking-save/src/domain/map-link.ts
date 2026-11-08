// 네이버 지도 앱 URL Scheme 링크 생성 (순수 함수).
// 근거: Ncloud Maps 문서 "URL Scheme for integration of Maps app"
//   https://guide.ncloud-docs.com/docs/en/application-maps-url-scheme-vpc (2026-11-07 확인)
// - 모든 URL에 appname 필수(모바일 웹은 웹 페이지 URL). 이름 파라미터는 URL 인코딩.
// - 좌표 허용 범위: 위도 31.43~44.35, 경도 122.37~132.00. 출발지(slat/slng) 생략 시 현재 위치.
// - 앱이 설치되어 있어야 동작. 미설치 시 스토어 이동은 호출 측이 구현해야 함.
// 이 서비스는 자체 내비게이션을 만들지 않고 지도 앱 호출만 한다. 실기기 동작은 미검증.

export interface MapPoint { lat: number; lng: number; name?: string }
export const NAVER_MAP_ANDROID_PACKAGE = "com.nhn.android.nmap";
export const NAVER_MAP_PLAY_URL = "https://play.google.com/store/apps/details?id=com.nhn.android.nmap";
export const NAVER_MAP_APPSTORE_URL = "http://itunes.apple.com/app/id311867728?mt=8"; // 문서의 iOS 예제 값

export const inKoreaRange = (p: { lat: number; lng: number }) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 31.43 && p.lat <= 44.35 && p.lng >= 122.37 && p.lng <= 132.0;

const MAX_NAME = 60;
const enc = (s: string) => encodeURIComponent(s.trim().slice(0, MAX_NAME));
const num = (n: number) => String(Number(n.toFixed(7)));

function query(parts: Array<[string, string | undefined]>, appname: string): string {
  return [...parts.filter(([, v]) => v !== undefined && v !== ""), ["appname", encodeURIComponent(appname)]].map(([k, v]) => `${k}=${v}`).join("&");
}

export interface NaverLinkSet { scheme: string; androidIntent: string }
export interface NaverLinks {
  /** 현재 위치 → 주차장 (자동차 길찾기) */
  car: NaverLinkSet | null;
  /** 주차장 → 목적지 (도보 길찾기). 목적지 좌표가 있을 때만 */
  walk: NaverLinkSet | null;
  /** 주차장 위치 마커 */
  place: NaverLinkSet | null;
}

const link = (action: string, q: string): NaverLinkSet => ({
  scheme: `nmap://${action}?${q}`,
  androidIntent: `intent://${action}?${q}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=${NAVER_MAP_ANDROID_PACKAGE};end`,
});

export function buildNaverLinks(opts: { lot: MapPoint; destination?: MapPoint | null; appname: string }): NaverLinks {
  const { lot, destination, appname } = opts;
  if (!appname || !inKoreaRange(lot)) return { car: null, walk: null, place: null };
  const lotName = lot.name ? enc(lot.name) : undefined;
  const car = link("route/car", query([["dlat", num(lot.lat)], ["dlng", num(lot.lng)], ["dname", lotName]], appname));
  const place = lotName ? link("place", query([["lat", num(lot.lat)], ["lng", num(lot.lng)], ["name", lotName]], appname)) : null;
  const walk = destination && inKoreaRange(destination)
    ? link("route/walk", query([
        ["slat", num(lot.lat)], ["slng", num(lot.lng)], ["sname", lotName],
        ["dlat", num(destination.lat)], ["dlng", num(destination.lng)], ["dname", destination.name ? enc(destination.name) : undefined],
      ], appname))
    : null;
  return { car, walk, place };
}
