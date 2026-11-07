import type { Metadata } from "next";
import "./globals.css";
import { MockBanner } from "@/components/MockBanner";
import { mockEnabled } from "@/server/mock";

export const metadata: Metadata = {
  title: { default: "파킹세이브 - 공영주차장 요금 비교", template: "%s | 파킹세이브" },
  description: "주차하기 전에, 주차비부터 아끼자! 전국 공영주차장 통합 검색·주차비 비교.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a href="#main" className="skip-link">본문으로 건너뛰기</a>
        {mockEnabled() && <MockBanner />}
        <main id="main" className="mx-auto max-w-2xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
