"use client";
import { useEffect, useState } from "react";

/** 내보내기 링크: 누르면 준비 중 안내를 잠시 보여 중복 클릭을 줄인다(다운로드 자체는 브라우저 기본 동작) */
export function ExportLinks({ qs }: { qs: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(null), busy === "PDF" ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [busy]);
  return (
    <>
      <span>현재 조건으로 내보내기:</span>
      {(["xlsx", "csv", "pdf"] as const).map((f) => {
        const label = f.toUpperCase();
        return (
          <a key={f} className="btn btn-ghost" href={`/api/export/${f}?${qs}`} aria-disabled={busy === label}
            onClick={(e) => { if (busy === label) e.preventDefault(); else setBusy(label); }}>
            {busy === label ? `${label} 준비 중…` : label}
          </a>
        );
      })}
      <span role="status" className="text-xs text-[var(--muted)]">{busy ? "파일을 만드는 중입니다. 건수가 많으면 몇 초 걸릴 수 있습니다." : ""}</span>
    </>
  );
}
