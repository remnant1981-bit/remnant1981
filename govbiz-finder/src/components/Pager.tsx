import Link from "next/link";

/** 페이지 번호 내비게이션(첫·이전·주변 번호·다음·끝). base 는 page 를 제외한 쿼리 문자열. */
export function Pager({ path, base, page, pages }: { path: string; base: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (n: number) => `${path}?${[base, n > 1 ? `page=${n}` : ""].filter(Boolean).join("&")}`;
  const from = Math.max(1, page - 2), to = Math.min(pages, page + 2);
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const cls = "inline-flex min-w-9 justify-center rounded-md border border-[var(--line)] px-2 py-1";
  return (
    <nav aria-label="페이지" className="no-print mt-6 flex flex-wrap items-center justify-center gap-1 text-sm">
      {page > 1 && <Link className={cls} href={href(1)} aria-label="첫 페이지">«</Link>}
      {page > 1 && <Link className={cls} href={href(page - 1)}>이전</Link>}
      {nums.map((n) => n === page
        ? <span key={n} aria-current="page" className={`${cls} border-[var(--brand)] bg-[var(--brand)] font-bold text-white`}>{n}</span>
        : <Link key={n} className={cls} href={href(n)}>{n}</Link>)}
      {page < pages && <Link className={cls} href={href(page + 1)}>다음</Link>}
      {page < pages && <Link className={cls} href={href(pages)} aria-label="마지막 페이지">»</Link>}
      <span className="ml-2 text-[var(--muted)]">{page} / {pages}</span>
    </nav>
  );
}
