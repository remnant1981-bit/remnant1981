// 공고문 자격요건 AI 추출 — 운영 처리(Batch 제출·결과 수집·규칙 조회). 설계: docs/AI_EXTRACTION_DESIGN.md
// - AI_EXTRACT_ENABLED=true 이고 ANTHROPIC_API_KEY 가 있을 때만 외부 API를 호출한다(기본 꺼짐).
// - 공고문(공개 데이터)만 전송한다. 기업정보는 이 모듈에서 읽지 않는다.
// - 월 예산(AI_MONTHLY_BUDGET_USD)을 넘지 않도록 제출 건수를 줄이고, 소진되면 제출하지 않는다.
import { nowIso, seoulToday } from "@/lib/time";
import type { Db } from "./db";
import type { Rule } from "@/domain/matching";
import { AI_EXTRACT_VERSION, AI_OUTPUT_SCHEMA, AI_SYSTEM_PROMPT, aiCostUsd, aiToRules, aiUserMessage, AI_PRICES, type AiExtraction } from "@/domain/ai-extract";

export interface AiConfig { enabled: boolean; hasKey: boolean; model: string; monthlyBudgetUsd: number; maxPerRun: number }
export function aiConfig(): AiConfig {
  const model = process.env.AI_EXTRACT_MODEL || "claude-opus-5-5";
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD ?? "20");
  const max = Number(process.env.AI_EXTRACT_MAX_PER_RUN ?? "500");
  return {
    enabled: process.env.AI_EXTRACT_ENABLED === "true",
    hasKey: !!process.env.ANTHROPIC_API_KEY,
    model,
    monthlyBudgetUsd: Number.isFinite(budget) && budget >= 0 ? budget : 20,
    maxPerRun: Number.isInteger(max) && max > 0 ? Math.min(max, 5000) : 500,
  };
}
/** 추출 결과를 판정·화면에 반영할지(기능 플래그). 끄면 저장된 결과도 쓰지 않음 */
export const aiRulesActive = () => process.env.AI_EXTRACT_ENABLED === "true";

// ---------- Batch API 최소 인터페이스(테스트에서 가짜로 대체) ----------
export interface BatchRequest { custom_id: string; params: Record<string, unknown> }
export interface BatchResultItem {
  custom_id: string;
  result:
    | { type: "succeeded"; message: { stop_reason: string | null; content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } } }
    | { type: "errored"; error?: { type?: string; error?: { type?: string } } }
    | { type: "canceled" | "expired" };
}
export interface BatchClient {
  create(requests: BatchRequest[]): Promise<{ id: string }>;
  status(id: string): Promise<string>; // in_progress | canceling | ended
  results(id: string): AsyncIterable<BatchResultItem>;
}

/** 실제 Anthropic 클라이언트(키가 있을 때만 생성) */
export async function anthropicBatchClient(): Promise<BatchClient> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const sdk = new Anthropic();
  type CreateParams = Parameters<typeof sdk.messages.batches.create>[0];
  return {
    create: async (requests) => sdk.messages.batches.create({ requests } as unknown as CreateParams),
    status: async (id) => (await sdk.messages.batches.retrieve(id)).processing_status,
    async *results(id) { for await (const r of await sdk.messages.batches.results(id)) yield r as unknown as BatchResultItem; },
  };
}

// ---------- 대상·예산 ----------
type Candidate = { id: string; content_hash: string; title: string; organization: string | null; region_scope: string | null; target_summary: string | null; eligibility_text: string | null; original_text: string | null };

/** 아직 추출하지 않은(원문·버전 기준) 접수 중/예정 공고. 마감 임박 순 */
export async function aiCandidates(db: Db, limit: number): Promise<Candidate[]> {
  return db.all<Candidate>(
    `SELECT a.id, a.content_hash, a.title, a.organization, a.region_scope, a.target_summary, a.eligibility_text, a.original_text
     FROM announcements a
     WHERE a.is_active=1 AND a.source_id <> 'mock' AND a.application_status IN ('open','upcoming','always','unknown')
       AND length(coalesce(a.original_text,'') || coalesce(a.eligibility_text,'')) > 200
       AND NOT EXISTS (SELECT 1 FROM ai_extractions e WHERE e.announcement_id=a.id AND e.content_hash=a.content_hash AND e.version=?)
     ORDER BY a.application_end IS NULL, a.application_end, a.id LIMIT ?`, [AI_EXTRACT_VERSION, limit]);
}

const monthStartIso = () => `${seoulToday().slice(0, 7)}-01T00:00:00+09:00`;
export async function aiMonthSpent(db: Db): Promise<number> {
  const r = await db.get<{ s: number | null }>("SELECT SUM(cost_usd) AS s FROM ai_extractions WHERE updated_at >= ?", [new Date(Date.parse(monthStartIso())).toISOString()]);
  return Number(r?.s ?? 0);
}
/** 1건 예상 비용(Batch, 생각 포함 출력 600토큰 여유) */
export function estimateCostUsd(model: string, c: Candidate): number {
  const inTok = Math.ceil((AI_SYSTEM_PROMPT.length + aiUserMessage(c).length) / 1.5);
  return aiCostUsd(model, inTok, 600, true);
}

export function batchParams(model: string, c: Candidate): Record<string, unknown> {
  return {
    model,
    max_tokens: 4000,
    system: [{ type: "text", text: AI_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: aiUserMessage(c) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: AI_OUTPUT_SCHEMA } },
  };
}

// ---------- 제출 ----------
export async function submitAiBatch(db: Db, client: BatchClient, cfg = aiConfig()): Promise<{ submitted: number; batchId: string | null; reason?: string }> {
  if (!cfg.enabled) return { submitted: 0, batchId: null, reason: "disabled" };
  if (!AI_PRICES[cfg.model]) return { submitted: 0, batchId: null, reason: "unknown_model" };
  const remaining = cfg.monthlyBudgetUsd - (await aiMonthSpent(db));
  if (remaining <= 0) return { submitted: 0, batchId: null, reason: "budget_exhausted" };
  const cands = await aiCandidates(db, cfg.maxPerRun);
  // 예산 안에 들어가는 만큼만(마감 임박 순)
  const picked: Candidate[] = [];
  let est = 0;
  for (const c of cands) { const e = estimateCostUsd(cfg.model, c); if (est + e > remaining) break; est += e; picked.push(c); }
  if (!picked.length) return { submitted: 0, batchId: null, reason: cands.length ? "budget_exhausted" : "nothing_to_do" };
  const batch = await client.create(picked.map((c) => ({ custom_id: c.id, params: batchParams(cfg.model, c) })));
  const now = nowIso();
  for (const c of picked) {
    await db.run(
      `INSERT INTO ai_extractions(announcement_id, content_hash, version, model, status, batch_id, created_at, updated_at) VALUES (?,?,?,?,'pending',?,?,?)
       ON CONFLICT(announcement_id, content_hash, version) DO UPDATE SET model=excluded.model, status='pending', batch_id=excluded.batch_id, error=NULL, updated_at=excluded.updated_at`,
      [c.id, c.content_hash, AI_EXTRACT_VERSION, cfg.model, batch.id, now, now]);
  }
  return { submitted: picked.length, batchId: batch.id };
}

// ---------- 결과 수집 ----------
export async function collectAiResults(db: Db, client: BatchClient): Promise<{ batches: number; ok: number; failed: number; inProgress: number }> {
  const out = { batches: 0, ok: 0, failed: 0, inProgress: 0 };
  const batches = await db.all<{ batch_id: string }>("SELECT DISTINCT batch_id FROM ai_extractions WHERE status='pending' AND batch_id IS NOT NULL");
  for (const { batch_id } of batches) {
    if ((await client.status(batch_id)) !== "ended") { out.inProgress++; continue; }
    out.batches++;
    const rows = await db.all<{ announcement_id: string; content_hash: string; version: string; model: string }>(
      "SELECT announcement_id, content_hash, version, model FROM ai_extractions WHERE status='pending' AND batch_id=?", [batch_id]);
    const byId = new Map(rows.map((r) => [r.announcement_id, r]));
    const fail = async (r: { announcement_id: string; content_hash: string; version: string }, error: string, extra: { in?: number; out?: number; usd?: number; raw?: string } = {}) => {
      out.failed++;
      await db.run(`UPDATE ai_extractions SET status='failed', error=?, output_json=?, input_tokens=?, output_tokens=?, cost_usd=?, updated_at=? WHERE announcement_id=? AND content_hash=? AND version=?`,
        [error.slice(0, 300), extra.raw?.slice(0, 20000) ?? null, extra.in ?? null, extra.out ?? null, extra.usd ?? 0, nowIso(), r.announcement_id, r.content_hash, r.version]);
    };
    for await (const item of client.results(batch_id)) {
      const r = byId.get(item.custom_id);
      if (!r) continue;
      byId.delete(item.custom_id);
      const res = item.result;
      if (res.type !== "succeeded") {
        await fail(r, res.type === "errored" ? `errored:${res.error?.error?.type ?? res.error?.type ?? "unknown"}` : res.type);
        continue;
      }
      const u = res.message.usage;
      const inTok = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      const usd = aiCostUsd(r.model, inTok, u.output_tokens, true);
      const text = res.message.content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* 아래 실패 처리 */ }
      if (res.message.stop_reason !== "end_turn" || !parsed || typeof parsed !== "object") {
        await fail(r, `invalid_output:${res.message.stop_reason}`, { in: inTok, out: u.output_tokens, usd, raw: text });
        continue;
      }
      const conv = aiToRules(parsed);
      out.ok++;
      await db.run(`UPDATE ai_extractions SET status='ok', error=NULL, output_json=?, rules_json=?, dropped_json=?, input_tokens=?, output_tokens=?, cost_usd=?, updated_at=? WHERE announcement_id=? AND content_hash=? AND version=?`,
        [text.slice(0, 20000), JSON.stringify(conv.rules), JSON.stringify(conv.dropped), inTok, u.output_tokens, usd, nowIso(), r.announcement_id, r.content_hash, r.version]);
    }
    for (const r of byId.values()) await fail(r, "no_result");
  }
  return out;
}

/** 수집 후 1회 실행: 끝난 배치 결과를 반영하고 새 대상을 제출 */
export async function runAiCycle(db: Db, client?: BatchClient, cfg = aiConfig()) {
  if (!cfg.enabled) return { skipped: "AI_EXTRACT_ENABLED가 true가 아님" };
  if (!client && !cfg.hasKey) return { skipped: "ANTHROPIC_API_KEY 없음" };
  const c = client ?? (await anthropicBatchClient());
  const collected = await collectAiResults(db, c);
  const submitted = await submitAiBatch(db, c, cfg);
  return { collected, submitted };
}

// ---------- 조회 ----------
/** 현재 원문·버전과 일치하는 AI 규칙(기능 꺼짐이면 빈 맵) */
export async function aiRulesFor(db: Db, ids: string[]): Promise<Map<string, Rule[]>> {
  const map = new Map<string, Rule[]>();
  if (!aiRulesActive() || !ids.length) return map;
  const rows = await db.all<{ announcement_id: string; rules_json: string | null }>(
    `SELECT e.announcement_id, e.rules_json FROM ai_extractions e JOIN announcements a ON a.id=e.announcement_id AND a.content_hash=e.content_hash
     WHERE e.status='ok' AND e.version=? AND e.announcement_id IN (${ids.map(() => "?").join(",")})`, [AI_EXTRACT_VERSION, ...ids]);
  for (const r of rows) { try { const v = JSON.parse(r.rules_json ?? "[]"); if (Array.isArray(v)) map.set(r.announcement_id, v as Rule[]); } catch { /* 손상 행 무시 */ } }
  return map;
}

/** 공고 상세의 'AI 요약(참고)'용 */
export async function aiExtractionFor(db: Db, id: string): Promise<{ summary: AiExtraction["summary"]; other: string[]; model: string; at: string } | null> {
  if (!aiRulesActive()) return null;
  const r = await db.get<{ output_json: string | null; model: string; updated_at: string }>(
    `SELECT e.output_json, e.model, e.updated_at FROM ai_extractions e JOIN announcements a ON a.id=e.announcement_id AND a.content_hash=e.content_hash
     WHERE e.status='ok' AND e.version=? AND e.announcement_id=?`, [AI_EXTRACT_VERSION, id]);
  if (!r?.output_json) return null;
  try {
    const o = JSON.parse(r.output_json) as Partial<AiExtraction>;
    const s = o.summary ?? { support: "", target: "", how_to_apply: "" };
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
    const other = Array.isArray(o.other_requirements) ? o.other_requirements.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 10) : [];
    return { summary: { support: str(s.support), target: str(s.target), how_to_apply: str(s.how_to_apply) }, other, model: r.model, at: r.updated_at };
  } catch { return null; }
}

/** 관리자 화면 현황 */
export async function aiStatus(db: Db) {
  const cfg = aiConfig();
  const counts = Object.fromEntries((await db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM ai_extractions WHERE version=? GROUP BY status", [AI_EXTRACT_VERSION])).map((r) => [r.status, Number(r.n)]));
  const total = await db.get<{ s: number | null }>("SELECT SUM(cost_usd) AS s FROM ai_extractions");
  const last = await db.get<{ t: string | null }>("SELECT MAX(updated_at) AS t FROM ai_extractions");
  return {
    enabled: cfg.enabled, hasKey: cfg.hasKey, model: cfg.model, monthlyBudgetUsd: cfg.monthlyBudgetUsd,
    monthSpentUsd: await aiMonthSpent(db), totalSpentUsd: Number(total?.s ?? 0),
    counts: { pending: counts.pending ?? 0, ok: counts.ok ?? 0, failed: counts.failed ?? 0 }, lastUpdatedAt: last?.t ?? null,
  };
}
