import { newId } from "@/lib/crypto";
import { nowIso, seoulToday } from "@/lib/time";
import { normalizeAnnouncement, upsertAnnouncement, refreshEstimatedStatuses } from "@/domain/announcements";
import type { Db } from "@/server/db";
import type { SourceAdapter } from "./types";

export interface RunOptions {
  retries?: number;           // 최초 시도 후 재시도 횟수
  baseDelayMs?: number;       // 지수형 백오프 기준
  sleep?: (ms: number) => Promise<void>;
  today?: string;
}

const safeMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** 한 원천을 독립 실행. 어떤 실패도 throw 하지 않고 collection_runs 에 기록한다. */
export async function runSource(db: Db, adapter: SourceAdapter, opts: RunOptions = {}) {
  const { retries = 2, baseDelayMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  const runId = newId();
  const started = nowIso();
  await db.run("INSERT INTO collection_runs(id, source_id, started_at, status) VALUES (?,?,?,'running')", [runId, adapter.sourceId, started]);
  const counts = { fetched: 0, inserted: 0, updated: 0, skipped: 0 };
  const errors: string[] = [];
  let status: "success" | "partial" | "failed" = "success";
  try {
    let raws: Awaited<ReturnType<SourceAdapter["fetch"]>> = [];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        raws = await adapter.fetch();
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
      }
    }
    if (lastErr) throw lastErr;
    counts.fetched = raws.length;
    for (const raw of raws) {
      try {
        const n = await normalizeAnnouncement(raw, opts.today ?? seoulToday());
        const r = await upsertAnnouncement(db, adapter.sourceId, n, `collector:${adapter.sourceId}`);
        if (r.action === "inserted") counts.inserted++;
        else if (r.action === "updated") counts.updated++;
        else counts.skipped++;
      } catch (e) {
        counts.skipped++;
        errors.push(`${raw?.sourceNoticeId ?? "?"}: ${safeMsg(e)}`);
      }
    }
    if (errors.length) status = counts.fetched - errors.length > 0 ? "partial" : "failed";
  } catch (e) {
    status = "failed";
    errors.push(safeMsg(e));
  }
  const finished = nowIso();
  const summary = errors.length ? errors.slice(0, 10).join(" | ") : null;
  await db.run(
    "UPDATE collection_runs SET finished_at=?, status=?, fetched_count=?, inserted_count=?, updated_count=?, skipped_count=?, error_summary=? WHERE id=?",
    [finished, status, counts.fetched, counts.inserted, counts.updated, counts.skipped, summary, runId],
  );
  if (status === "failed") await db.run("UPDATE data_sources SET last_error=? WHERE id=?", [summary, adapter.sourceId]);
  else await db.run("UPDATE data_sources SET last_success_at=?, last_error=? WHERE id=?", [finished, status === "partial" ? summary : null, adapter.sourceId]);
  return { runId, status, ...counts, errors };
}

/** 활성화된 원천을 각각 독립 실행. */
export async function runAll(db: Db, adapters: SourceAdapter[], opts: RunOptions = {}) {
  const enabled = new Set((await db.all<{ id: string }>("SELECT id FROM data_sources WHERE enabled=1")).map((r) => r.id));
  const out = [];
  for (const a of adapters) if (enabled.has(a.sourceId)) out.push({ source: a.sourceId, ...(await runSource(db, a, opts)) });
  await refreshEstimatedStatuses(db, opts.today);
  return out;
}
