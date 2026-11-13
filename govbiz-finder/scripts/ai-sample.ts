/**
 * 공고문 자격요건 AI 추출 — 모델별 샘플 비교(PC 전용, DB에 쓰지 않음).
 *   npm run ai:sample -- --dry-run                  → API 호출 없이 대상·예상 비용만 출력(키 불필요)
 *   npm run ai:sample                               → 50건 × 기본 3개 모델 실제 호출(ANTHROPIC_API_KEY 필요)
 *   옵션: --n 50 --models claude-haiku-5-5,claude-sonnet-5-5 --max-usd 3 --db ./data/dev.sqlite
 * 결과: data/ai-sample/report-<시각>.md(사람이 보는 비교표) + .json(원자료). data/ 는 커밋 대상 아님.
 * 공고문(공개 데이터)만 전송하며 기업정보는 보내지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AI_SYSTEM_PROMPT, AI_OUTPUT_SCHEMA, aiUserMessage, aiToRules, aiCostUsd, AI_PRICES } from "../src/domain/ai-extract";
import { textRulesFor, regionRulesFor } from "../src/server/recommend";
import type { Rule } from "../src/domain/matching";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DRY = process.argv.includes("--dry-run");
const N = Math.max(1, Math.min(200, Number(arg("n", "50"))));
const MODELS = arg("models", "claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_USD = Number(arg("max-usd", "3"));
const DB = path.resolve(arg("db", process.env.DATABASE_PATH || "./data/dev.sqlite"));
const INCLUDE_MOCK = process.argv.includes("--include-mock");

for (const m of MODELS) if (!AI_PRICES[m]) { console.error(`단가 미등록 모델: ${m} (src/domain/ai-extract.ts AI_PRICES)`); process.exit(1); }
if (!fs.existsSync(DB)) { console.error(`DB 없음: ${DB}`); process.exit(1); }

type Row = { id: string; source_id: string; title: string; organization: string | null; region_scope: string | null; target_summary: string | null; eligibility_text: string | null; original_text: string | null };
const db = new DatabaseSync(DB, { readOnly: true });
// 본문이 있는 공고 중 기관·지역이 고르게 섞이도록 해시 순으로 추출(매번 같은 표본)
const rows = db.prepare(
  `SELECT id, source_id, title, organization, region_scope, target_summary, eligibility_text, original_text FROM announcements
   WHERE length(coalesce(original_text,'') || coalesce(eligibility_text,'')) > 200 ${INCLUDE_MOCK ? "" : "AND source_id <> 'mock'"}
   ORDER BY content_hash LIMIT ?`).all(N) as Row[];
if (!rows.length) { console.error("본문이 있는 공고가 없음. 먼저 수집(npm run collect) 필요."); process.exit(1); }

// 예상 비용(입력 ≈ 문자수/1.5 토큰 + 시스템 프롬프트, 출력 ≈ 600 토큰[생각 포함 여유])
const sysTok = Math.ceil(AI_SYSTEM_PROMPT.length / 1.5);
const estIn = rows.reduce((s, r) => s + sysTok + Math.ceil(aiUserMessage(r).length / 1.5), 0);
const estOut = rows.length * 600;
console.log(`대상 ${rows.length}건 · DB ${DB}`);
for (const m of MODELS) console.log(`  ${m}: 예상 약 $${aiCostUsd(m, estIn, estOut).toFixed(2)} (입력 ${estIn.toLocaleString()} / 출력 ${estOut.toLocaleString()} 토큰 추정)`);
console.log(`  비용 상한 --max-usd ${MAX_USD} (초과 시 중단)`);
if (DRY) process.exit(0);
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY 환경변수가 없음(코드·채팅에 키를 붙여넣지 말 것)."); process.exit(1); }

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic();

const fmtRules = (rs: Rule[]) => rs.map((r) => `${r.field_key} ${r.operator} ${r.expected_value} (${(r.confidence ?? 1).toFixed(2)})`).join("<br>") || "-";
const results: Record<string, unknown>[] = [];
let spent = 0;
const totals: Record<string, { in: number; out: number; usd: number; ms: number; ok: number; fail: number }> = {};

outer: for (const r of rows) {
  const base = [...(r.region_scope ? regionRulesFor(r.region_scope) : []), ...textRulesFor(r)];
  const item: Record<string, unknown> = { id: r.id, title: r.title, region_scope: r.region_scope, ruleBased: base, models: {} };
  for (const model of MODELS) {
    if (spent >= MAX_USD) { console.log(`비용 상한 도달($${spent.toFixed(2)}) → 중단`); break outer; }
    const t = (totals[model] ??= { in: 0, out: 0, usd: 0, ms: 0, ok: 0, fail: 0 });
    const t0 = Date.now();
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 4000,
        system: [{ type: "text", text: AI_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: aiUserMessage(r) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: AI_OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      });
      const ms = Date.now() - t0;
      const inTok = res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
      const usd = aiCostUsd(model, inTok, res.usage.output_tokens);
      spent += usd; t.in += inTok; t.out += res.usage.output_tokens; t.usd += usd; t.ms += ms;
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* 아래에서 실패 처리 */ }
      if (res.stop_reason !== "end_turn" || !parsed) { t.fail++; (item.models as Record<string, unknown>)[model] = { error: `stop_reason=${res.stop_reason}`, raw: text.slice(0, 500) }; continue; }
      t.ok++;
      const conv = aiToRules(parsed);
      (item.models as Record<string, unknown>)[model] = { output: parsed, rules: conv.rules, dropped: conv.dropped, usage: res.usage, usd, ms };
    } catch (e) {
      t.fail++;
      (item.models as Record<string, unknown>)[model] = { error: e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : String(e) };
      if (e instanceof Anthropic.AuthenticationError) { console.error("API 키 인증 실패 → 중단"); break outer; }
    }
  }
  results.push(item);
  process.stdout.write(`\r진행 ${results.length}/${rows.length} · 누적 $${spent.toFixed(3)}`);
}
console.log();

const outDir = path.resolve("data/ai-sample");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.writeFileSync(path.join(outDir, `report-${stamp}.json`), JSON.stringify({ db: DB, models: MODELS, totals, results }, null, 2));

const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
let md = `# AI 자격요건 추출 샘플 비교 (${stamp})\n\n대상 ${results.length}건 · 총 비용 $${spent.toFixed(3)}\n\n## 모델별 합계\n\n| 모델 | 성공/실패 | 입력 토큰 | 출력 토큰 | 비용 | 1,300건 환산 | 평균 응답(초) |\n|---|---|---|---|---|---|---|\n`;
for (const [m, t] of Object.entries(totals)) {
  const n = t.ok + t.fail || 1;
  md += `| ${m} | ${t.ok}/${t.fail} | ${t.in.toLocaleString()} | ${t.out.toLocaleString()} | $${t.usd.toFixed(3)} | $${((t.usd / n) * 1300).toFixed(2)} (Batch $${((t.usd / n) * 650).toFixed(2)}) | ${(t.ms / n / 1000).toFixed(1)} |\n`;
}
md += `\n## 공고별 비교 (규칙 기반 vs 모델)\n\n판정 기준: 원문을 보고 각 모델이 뽑은 조건이 맞는지(누락·오추출) 표시해 주면 모델 선택에 사용함.\n\n| # | 공고 | 규칙 기반(현재) | ${MODELS.join(" | ")} |\n|---|---|---|${MODELS.map(() => "---").join("|")}|\n`;
results.forEach((it, i) => {
  const cells = MODELS.map((m) => {
    const v = (it.models as Record<string, { rules?: Rule[]; dropped?: string[]; error?: string; output?: { other_requirements?: string[] } }>)[m];
    if (!v) return "-";
    if (v.error) return `오류: ${esc(v.error)}`;
    const other = v.output?.other_requirements?.length ? `<br>기타: ${esc(v.output.other_requirements.join(" / "))}` : "";
    const drop = v.dropped?.length ? `<br>제외: ${esc(v.dropped.join(" / "))}` : "";
    return fmtRules(v.rules ?? []) + other + drop;
  });
  md += `| ${i + 1} | ${esc(it.title)} | ${fmtRules(it.ruleBased as Rule[])} | ${cells.join(" | ")} |\n`;
});
const mdPath = path.join(outDir, `report-${stamp}.md`);
fs.writeFileSync(mdPath, md);
console.log(`결과: ${mdPath}`);
