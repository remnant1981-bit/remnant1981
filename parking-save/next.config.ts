import type { NextConfig } from "next";

const securityHeaders = [
  // HTTPS 강제(운영만). nginx+certbot으로 HTTPS 제공 후 유효 — HTTP로 접속하면 브라우저가 무시함. 하위 도메인·preload는 도메인 확정 후 결정
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 위치 권한은 사용자 동의 후 현재 위치 검색에만 사용(자기 출처 허용)
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // CSP는 실행 시점에 지도 제공자에 맞춰 src/proxy.ts에서 붙임(src/lib/csp.ts)
];

const config: NextConfig = {
  reactStrictMode: true,
  // 컨테이너 배포용 최소 실행 파일(.next/standalone). 로컬 `next start`에는 영향 없음
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // 서비스 워커는 항상 최신본을 받도록(배포 후 옛 워커가 남지 않게)
      // 아이콘은 파일명이 고정이라 하루만 캐시(교체 시 최대 하루 뒤 반영)
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};
export default config;
