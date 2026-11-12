// 혼잡 경향: 과거 같은 요일 유형·같은 시간대의 평균 빈자리 비율. 예측이 아니라 '평소 경향'으로만 표시한다.
// 원칙: 관측일이 TREND_MIN_DAYS 미만이면 표시하지 않음. 공휴일 데이터가 없는 기간의 평일은 공휴일 여부를 몰라 제외.
import type { OccupancyConfig } from "./occupancy";

export interface HourlyRow { ymd: string; hour: number; ratioSum: number; samples: number }
export type DayKind = "WEEKDAY" | "WEEKEND";
export const TREND_MIN_DAYS = 4;
export const TREND_WINDOW_DAYS = 56;

/** KST 날짜의 요일 유형. 토·일·공휴일 = WEEKEND. 평일인데 공휴일 정보가 없으면 판정 불가(null) */
export function dayKind(ymd: string, holidays: ReadonlySet<string> | null): DayKind | null {
  const dow = new Date(`${ymd}T12:00:00+09:00`).getUTCDay();
  if (dow === 0 || dow === 6) return "WEEKEND";
  if (!holidays) return null;
  return holidays.has(ymd) ? "WEEKEND" : "WEEKDAY";
}

export interface Trend { kind: DayKind; hour: number; availablePct: number; days: number; level: "RELAXED" | "NORMAL" | "BUSY" }

/**
 * @param holidaysFor 날짜별 공휴일 집합 조회(그 날짜가 공휴일 데이터 범위 밖이면 null)
 */
export function occupancyTrend(rows: HourlyRow[], target: { kind: DayKind; hour: number }, holidaysFor: (ymd: string) => ReadonlySet<string> | null, cfg: Pick<OccupancyConfig, "relaxedAtOrAbovePct" | "busyBelowPct">): Trend | null {
  const perDay = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.hour !== target.hour || !(r.samples > 0) || !Number.isFinite(r.ratioSum)) continue;
    if (dayKind(r.ymd, holidaysFor(r.ymd)) !== target.kind) continue;
    const d = perDay.get(r.ymd) ?? { sum: 0, n: 0 };
    d.sum += r.ratioSum; d.n += r.samples;
    perDay.set(r.ymd, d);
  }
  if (perDay.size < TREND_MIN_DAYS) return null;
  // 날짜마다 평균을 낸 뒤 다시 평균(관측 횟수가 많은 날이 과대 반영되지 않게)
  const avg = [...perDay.values()].reduce((a, d) => a + Math.min(1, Math.max(0, d.sum / d.n)), 0) / perDay.size;
  const pct = Math.round(avg * 100);
  const level = pct >= cfg.relaxedAtOrAbovePct ? "RELAXED" : pct < cfg.busyBelowPct ? "BUSY" : "NORMAL";
  return { kind: target.kind, hour: target.hour, availablePct: pct, days: perDay.size, level };
}
