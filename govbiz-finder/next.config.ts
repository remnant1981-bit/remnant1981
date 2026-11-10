import type { NextConfig } from "next";

const ADS = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
  ? " https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com https://*.adtrafficquality.google"
  : "";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HTTPS 강제(운영에서만). 로컬 http 개발·PC 실행에는 영향 없음
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data:" + ADS + "; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") + ADS +
      "; connect-src 'self'" + ADS + "; frame-src 'self'" + ADS + "; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["exceljs", "pdf-lib", "@pdf-lib/fontkit"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // 아이콘은 내용이 거의 바뀌지 않으므로 하루 캐시(재방문 속도)
      { source: "/icons/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
};
export default config;
