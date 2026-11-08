"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { daysLeft, readGuestMarks, serverGuestMarks, subscribeGuestMarks } from "@/lib/guest-bookmarks";

type Item = { href: string; label: string; strong?: boolean; badge?: number; guestDeadlineBadge?: boolean };

/** 현재 위치를 표시하는 상단 메뉴. badge: 마감 7일 이내 관심 공고 수 */
export function NavLinks({ items }: { items: Item[] }) {
  const path = usePathname();
  const marks = useSyncExternalStore(subscribeGuestMarks, readGuestMarks, serverGuestMarks);
  const guestSoon = marks.filter((m) => { const d = daysLeft(m.end); return d !== null && d >= 0 && d <= 7; }).length;
  return (
    <>
      {items.map((n) => {
        const base = n.href.split("?")[0];
        const active = base === "/" ? path === "/" : path.startsWith(base);
        const badge = n.guestDeadlineBadge ? guestSoon : n.badge ?? 0;
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={`relative rounded-full px-3 py-1.5 transition-colors ${active ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]" : n.strong ? "font-semibold text-[var(--brand)] hover:bg-[var(--brand-soft)]" : "text-[var(--ink)] hover:bg-slate-100"}`}>
            {n.label}
            {badge > 0 && <span className="ml-1 inline-grid min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white" title={`마감 7일 이내 관심 공고 ${badge}건`} aria-label={`마감 임박 ${badge}건`}>{badge}</span>}
          </Link>
        );
      })}
    </>
  );
}
