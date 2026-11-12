import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 위치 권한은 사용자 동의 후 현재 위치 검색에만 사용(자기 출처 허용)
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // CSP: 외부 스크립트·연결 없음(네이버 지도 등 외부 앱은 링크 이동). Next 하이드레이션 인라인 스크립트 때문에 script-src 'unsafe-inline' 필요(nonce 방식은 후속).
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") +
      "; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  // 컨테이너 배포용 최소 실행 파일(.next/standalone). 로컬 `next start`에는 영향 없음
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;
