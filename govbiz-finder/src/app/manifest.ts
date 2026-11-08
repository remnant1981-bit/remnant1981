import type { MetadataRoute } from "next";

// 홈 화면 설치(PWA): 앱 아이콘으로 주소창 없이 실행
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GovBiz Finder - 기업지원사업 통합 검색",
    short_name: "GovBiz",
    description: "우리 기업에 맞는 정부·지자체 지원사업을 한곳에서 찾고 마감 전에 확인하세요.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#1d4ed8",
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "우리 기업 공고", url: "/recommend", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "공고 검색", url: "/search", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
