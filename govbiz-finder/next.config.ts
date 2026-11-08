import type { NextConfig } from "next";

const ADS = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
  ? " https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com https://*.adtrafficquality.google"
  : "";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;
