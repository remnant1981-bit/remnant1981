// 운영 현황 집계: 지표별 건수를 메모리에 모았다가 1분마다(또는 조회 직전) DB의 일별 합계에 더한다.
// 요청마다 DB에 쓰지 않아 부하가 거의 없고, 개인을 알 수 있는 값(IP·좌표·검색어)은 다루지 않는다.
// 서버가 갑자기 꺼지면 마지막 1분 안의 건수는 빠질 수 있다(참고용 지표).
import type { Db } from "./db";

export const USAGE_METRICS = ["search_page", "search_api", "lot_view", "report", "error", "rate_limited", "search_cache_hit"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
export const USAGE_RETENTION_DAYS = 400;

// Next 운영 빌드는 경로별로 서버 모듈을 따로 묶을 수 있어(모듈 변수가 경로마다 따로 생김) 프로세스 전역에 둔다.
type Flusher = { db: () => Promise<Db>; timer: ReturnType<typeof setInterval> };
const G = globalThis as typeof globalThis & { __psUsage?: { pending: Map<string, number>; flusher: Flusher | null } };
const state = (G.__psUsage ??= { pending: new Map(), flusher: null });
const pending = state.pending; // "YYYY-MM-DD|metric" → 건수
const kstYmd = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

export function countUsage(metric: UsageMetric, now = Date.now()) {
  const k = `${kstYmd(now)}|${metric}`;
  pending.set(k, (pending.get(k) ?? 0) + 1);
}

/** 모아 둔 건수를 DB에 더함. 실패하면 건수를 되돌려 다음에 다시 시도 */
export async function flushUsage(db: Db, now = Date.now()): Promise<number> {
  if (pending.size === 0) return 0;
  const batch = [...pending]; pending.clear();
  try {
    await db.transaction(async () => {
      for (const [k, n] of batch) {
        const [ymd, metric] = k.split("|");
        await db.run("INSERT INTO usage_daily(ymd, metric, n) VALUES (?,?,?) ON CONFLICT(ymd, metric) DO UPDATE SET n = n + excluded.n", [ymd, metric, n]);
      }
      await db.run("DELETE FROM usage_daily WHERE ymd < ?", [kstYmd(now - USAGE_RETENTION_DAYS * 86400_000)]);
    });
    return batch.reduce((a, [, n]) => a + n, 0);
  } catch (e) {
    for (const [k, n] of batch) pending.set(k, (pending.get(k) ?? 0) + n);
    throw e;
  }
}

/** 1분마다 자동 저장(앱 DB 준비 후 한 번만 시작). 프로세스 종료를 막지 않음 */
export function startUsageFlusher(getDb: () => Promise<Db>, intervalMs = 60_000) {
  if (state.flusher) return;
  const timer = setInterval(() => { getDb().then((db) => flushUsage(db)).catch(() => { /* 다음 주기에 재시도 */ }); }, intervalMs);
  timer.unref?.();
  state.flusher = { db: getDb, timer };
}

export interface DailyUsage { ymd: string; metrics: Partial<Record<UsageMetric, number>> }
export async function usageSeries(db: Db, days: number, now = Date.now()): Promise<DailyUsage[]> {
  await flushUsage(db, now).catch(() => {});
  const from = kstYmd(now - (days - 1) * 86400_000);
  const rows = await db.all<{ ymd: string; metric: UsageMetric; n: number }>("SELECT ymd, metric, n FROM usage_daily WHERE ymd >= ? ORDER BY ymd", [from]);
  const out: DailyUsage[] = Array.from({ length: days }, (_, i) => ({ ymd: kstYmd(now - (days - 1 - i) * 86400_000), metrics: {} }));
  const idx = new Map(out.map((d, i) => [d.ymd, i]));
  for (const r of rows) { const i = idx.get(r.ymd); if (i != null) out[i].metrics[r.metric] = r.n; }
  return out;
}
export function resetUsageForTest() { pending.clear(); if (state.flusher) { clearInterval(state.flusher.timer); state.flusher = null; } }
