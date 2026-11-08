// 공고 본문(평문)을 읽기 좋은 블록으로 나눈다. 외부 텍스트는 비신뢰 입력이므로 HTML 로 해석하지 않고 텍스트로만 다룬다.
export type Block = { type: "heading" | "bullet" | "note" | "para"; text: string };

const HEADING = /^[☞👉■□◆◇▶▷●○]\s*/u;
const NOTE = /^※\s*/u;
const BULLET = /^[-ㆍ·•*]\s+/u;

export function parseBlocks(text: string | null | undefined): Block[] {
  const out: Block[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (HEADING.test(line)) out.push({ type: "heading", text: line.replace(HEADING, "") });
    else if (NOTE.test(line)) out.push({ type: "note", text: line.replace(NOTE, "") });
    else if (BULLET.test(line)) out.push({ type: "bullet", text: line.replace(BULLET, "") });
    else out.push({ type: "para", text: line });
  }
  return out;
}

/** 목록 카드용 한두 문장 요약: 첫 문장(최대 max자). */
export function shortSummary(text: string | null | undefined, max = 110): string {
  const first = (text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const clean = first.replace(/\s+/g, " ");
  const m = clean.match(/^(.{20,}?[.다요]\s)/u);
  const sentence = m ? m[1].trim() : clean;
  return sentence.length > max ? sentence.slice(0, max).trimEnd() + "…" : sentence;
}
