import type { MetadataRoute } from "next";

/** 홈 화면 설치(PWA) 정보 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "파킹세이브 - 공영주차장 요금 비교",
    short_name: "파킹세이브",
    description: "주차하기 전에, 주차비부터 아끼자! 전국 공영주차장 예상 요금 비교.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
