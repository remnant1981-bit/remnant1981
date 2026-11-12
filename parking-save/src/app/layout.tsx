import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MockBanner } from "@/components/MockBanner";
import { mockEnabled } from "@/server/mock";
import { PwaRegister } from "@/components/PwaRegister";
import Link from "next/link";

export const metadata: Metadata = {
  title: { default: "파킹세이브 - 공영주차장 요금 비교", template: "%s | 파킹세이브" },
  description: "주차하기 전에, 주차비부터 아끼자! 전국 공영주차장 통합 검색·주차비 비교.",
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "파킹세이브", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#1d4ed8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a href="#main" className="skip-link">본문으로 건너뛰기</a>
        {mockEnabled() && <MockBanner />}
        <PwaRegister />
        <main id="main" className="mx-auto max-w-2xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-2xl px-4 pb-8 text-xs text-gray-600">
          <nav aria-label="서비스 정보" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/terms" className="underline">이용약관</Link>
            <Link href="/privacy" className="underline">개인정보·위치정보 처리방침</Link>
          </nav>
          <p className="mt-1">주차장 정보: 공공데이터포털 전국주차장정보표준데이터 · 요금은 예상 금액이며 현장 안내가 우선합니다.</p>
        </footer>
      </body>
    </html>
  );
}
