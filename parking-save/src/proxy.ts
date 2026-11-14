// 모든 화면·API 응답에 CSP를 붙인다(실행 시점 환경변수로 지도 제공자를 반영 — 다시 빌드 없이 네이버 지도 전환 가능).
// 정적 파일(_next/static, 아이콘 등)은 제외해 비용을 줄인다.
import { NextResponse } from "next/server";
import { buildCsp } from "@/lib/csp";
import { mapProvider } from "@/lib/map-tiles";

export function proxy() {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", buildCsp(mapProvider().provider.kind));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|favicon\\.ico|manifest\\.webmanifest|sw\\.js).*)"],
};
