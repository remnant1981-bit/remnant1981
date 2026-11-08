import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Script from "next/script";
import { getViewer } from "@/server/viewer";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLinks } from "@/components/NavLinks";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: { default: "GovBiz Finder - 기업지원사업 통합 검색", template: "%s | GovBiz Finder" },
  description: "몰라서 놓치는 지원사업이 없도록. 중앙부처·공공기관·지자체 기업지원사업을 한곳에서 검색하고 공식 원문으로 확인하세요.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const v = await getViewer();
  return (
    <html lang="ko">
      <body>
        {process.env.NEXT_PUBLIC_ADSENSE_CLIENT && (
          <Script id="adsense" async strategy="afterInteractive" crossOrigin="anonymous"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_ADSENSE_CLIENT}`} />
        )}
        <a href="#main" className="skip-link">본문으로 건너뛰기</a>
        <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--brand)]">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--brand)] text-sm text-white">G</span>GovBiz Finder
            </Link>
            <nav aria-label="주 메뉴" className="flex flex-wrap items-center gap-1 text-sm">
              <NavLinks items={[
                { href: "/search", label: "공고 검색" },
                ...(v.profile ? [{ href: "/recommend", label: "우리 기업 공고", strong: true }] : [{ href: "/recommend", label: "우리 기업 맞춤 공고", strong: true }]),
                ...(v.session ? [{ href: "/my", label: "내 공고·알림" }, { href: "/company", label: "기업정보" }] : []),
                ...(v.session?.user.role === "admin" ? [{ href: "/admin", label: "관리자" }] : []),
              ]} />
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              {v.session ? (<><span className="hidden text-[var(--muted)] sm:inline" aria-label="로그인 계정">{v.session.user.email}</span><LogoutButton /></>) : (
                <><Link href="/login" className="hover:underline">로그인</Link><Link href="/register" className="btn">회원가입</Link></>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-[var(--muted)]">
          <p>본 서비스의 정보는 참고용이며 최종 신청 자격·접수 상태는 공식 원문과 담당기관 확인이 기준입니다. 수집 대상으로 연동된 기관의 공고만 제공되며 모든 기관을 포함한다고 보장하지 않습니다.</p>
        </footer>
      </body>
    </html>
  );
}
