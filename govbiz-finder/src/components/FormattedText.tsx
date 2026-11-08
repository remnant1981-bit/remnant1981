import { parseBlocks } from "@/lib/format";

/** 본문을 소제목(☞)·글머리표(-)·주석(※)·문단으로 구분해 보여 준다. */
export function FormattedText({ text, empty = "확인 필요 (원문 참고)" }: { text: string | null | undefined; empty?: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return <p className="text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <div className="grid gap-1.5 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <p key={i} className="mt-2 border-l-4 border-[var(--brand)] pl-2 font-semibold first:mt-0">{b.text}</p>
        ) : b.type === "bullet" ? (
          <p key={i} className="flex gap-2 pl-4"><span aria-hidden className="text-[var(--muted)]">•</span><span>{b.text}</span></p>
        ) : b.type === "note" ? (
          <p key={i} className="pl-4 text-xs text-[var(--muted)]">※ {b.text}</p>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}
