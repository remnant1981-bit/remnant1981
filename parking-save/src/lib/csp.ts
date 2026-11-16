// Content-Security-Policy: 실행 시점에 지도 제공자에 맞춰 만든다(src/proxy.ts가 모든 화면 응답에 붙임).
// 기본(OSM·브이월드)은 외부 스크립트·연결 없음. 네이버 지도를 켠 경우에만 네이버 SDK 도메인을 추가로 허용한다.
// Next 하이드레이션 인라인 스크립트 때문에 script-src 'unsafe-inline' 필요(nonce 방식은 후속).
import { NAVER_CSP, TILE_HOSTS, type MapProvider } from "./map-tiles";

export function buildCsp(provider: MapProvider["kind"], dev = process.env.NODE_ENV !== "production"): string {
  const naver = provider === "naver";
  const list = (base: string[], extra: readonly string[]) => [...base, ...(naver ? extra : [])].join(" ");
  return [
    "default-src 'self'",
    `img-src ${list(["'self'", "data:", ...TILE_HOSTS], NAVER_CSP.img)}`,
    `style-src ${list(["'self'", "'unsafe-inline'"], NAVER_CSP.style)}`,
    `script-src ${list(["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])], NAVER_CSP.script)}`,
    `connect-src ${list(["'self'"], NAVER_CSP.connect)}`,
    "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; ");
}
