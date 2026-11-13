"use client";
import { useEffect, useRef } from "react";

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT; // 예: ca-pub-xxxxxxxx (미설정 시 광고 비활성)

/**
 * 광고 영역. 검색 결과와 명확히 구분되도록 '광고' 표시를 붙이고, 순위·적합도에는 관여하지 않는다(ADMIN_SEO §2).
 * NEXT_PUBLIC_ADSENSE_CLIENT 와 슬롯 ID 가 모두 있을 때만 렌더링한다.
 */
export function AdSlot({ slot, className = "", show = true }: { slot: string | undefined; className?: string; show?: boolean }) {
  const ref = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!show || !CLIENT || !slot || !ref.current) return;
    try { ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ||= []).push({}); } catch { /* 광고 차단 등 무시 */ }
  }, [slot, show]);
  if (!show || !CLIENT || !slot) return null; // 유료 요금제는 광고 없음
  return (
    <aside aria-label="광고" className={`no-print rounded-xl border border-dashed border-[var(--line)] bg-white p-3 ${className}`}>
      <p className="mb-1 text-[11px] font-semibold text-[var(--muted)]">광고</p>
      <ins ref={ref} className="adsbygoogle" style={{ display: "block" }} data-ad-client={CLIENT} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}
