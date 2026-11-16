"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** 이 사이트 목록에서 들어왔으면 뒤로가기(검색 조건·스크롤 유지), 아니면 fallback 경로로 이동 */
export function BackToResults({ fallback = "/search", children }: { fallback?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className="inline-block py-2 text-sm text-[var(--brand)] underline"
      onClick={(e) => {
        try {
          const ref = document.referrer ? new URL(document.referrer) : null;
          if (ref && ref.origin === window.location.origin && ref.pathname !== window.location.pathname && window.history.length > 1) {
            e.preventDefault();
            router.back();
          }
        } catch { /* 기본 링크 동작 */ }
      }}
    >
      {children}
    </Link>
  );
}
