import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getViewer } from "@/server/viewer";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: { default: "GovBiz Finder - 기업지원사업 통합 검색", template: "%s | GovBiz Finder" },
  description: "몰라서 놓치는 지원사업이 없도록. 중앙부처·공공기관·지자체 기업지원사업을 한곳에서 검색하고 공식 원문으로 확인하세요.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const v = await getViewer();
  const nav = [
    { href: "/search", label: "공고 검색" },
    { href: "/recommend", label: "맞춤 추천" },
  ];
  return (
    <html lang="ko">
      <body>
        <a href="#main" className="skip-link">본문으로 건너뛰기</a>
        <header className="border-b border-[var(--line)] bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-lg font-bold text-[var(--brand)]">GovBiz Finder</Link>
            <nav aria-label="주 메뉴" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              {nav.map((n) => <Link key={n.href} href={n.href} className="hover:underline">{n.label}</Link>)}
              {v.session && <Link href="/my" className="hover:underline">내 공고·알림</Link>}
              {v.session && <Link href="/company" className="hover:underline">기업정보</Link>}
              {v.session?.user.role === "admin" && <Link href="/admin" className="hover:underline">관리자</Link>}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              {v.session ? (<><span className="text-[var(--muted)]" aria-label="로그인 계정">{v.session.user.email}</span><LogoutButton /></>) : (
                <><Link href="/login" className="underline">로그인</Link><Link href="/register" className="btn">회원가입</Link></>
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
