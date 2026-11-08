"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** 현재 위치를 표시하는 상단 메뉴. */
export function NavLinks({ items }: { items: { href: string; label: string; strong?: boolean }[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((n) => {
        const base = n.href.split("?")[0];
        const active = base === "/" ? path === "/" : path.startsWith(base);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 transition-colors ${active ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]" : n.strong ? "font-semibold text-[var(--brand)] hover:bg-[var(--brand-soft)]" : "text-[var(--ink)] hover:bg-slate-100"}`}>
            {n.label}
          </Link>
        );
      })}
    </>
  );
}
