// 실시간 잔여면수·혼잡도. 데이터가 없거나 오래되면 추정하지 않고 UNAVAILABLE.
export interface OccupancyInput {
  totalSpaces: number | null | undefined;
  availableSpaces: number | null | undefined;
  observedAt: string | null | undefined; // ISO8601 (offset 포함)
}
export interface OccupancyConfig {
  maxAgeMinutes: number;      // 신선도 기준 — 원천별 갱신주기 확인 후 설정(OPEN_ISSUES #7)
  relaxedAtOrAbovePct: number; // 잔여비율 ≥ 값 → 여유  (OPEN_ISSUES #8, 임시값)
  busyBelowPct: number;        // 잔여비율 < 값 → 혼잡
}
export const DEFAULT_OCCUPANCY_CONFIG: OccupancyConfig = { maxAgeMinutes: 10, relaxedAtOrAbovePct: 30, busyBelowPct: 10 };

export type OccupancyResult =
  | { status: "UNAVAILABLE"; reason: "NO_DATA" | "NO_OBSERVED_AT" | "STALE" | "INVALID_VALUES" } // UI: 실시간 확인 불가
  | { status: "AVAILABLE"; availableSpaces: number; totalSpaces: number; remainingPct: number;
      congestion: "RELAXED" | "NORMAL" | "BUSY"; observedAt: string };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

export function evaluateOccupancy(i: OccupancyInput, now: Date, cfg: OccupancyConfig = DEFAULT_OCCUPANCY_CONFIG): OccupancyResult {
  if (i.totalSpaces == null || i.availableSpaces == null) return { status: "UNAVAILABLE", reason: "NO_DATA" };
  if (!i.observedAt) return { status: "UNAVAILABLE", reason: "NO_OBSERVED_AT" };
  const t = Date.parse(i.observedAt);
  if (Number.isNaN(t)) return { status: "UNAVAILABLE", reason: "NO_OBSERVED_AT" };
  if (!isInt(i.totalSpaces) || !isInt(i.availableSpaces) || i.totalSpaces <= 0 || i.availableSpaces < 0 || i.availableSpaces > i.totalSpaces) {
    return { status: "UNAVAILABLE", reason: "INVALID_VALUES" };
  }
  const ageMin = (now.getTime() - t) / 60000;
  if (ageMin > cfg.maxAgeMinutes || ageMin < -1) return { status: "UNAVAILABLE", reason: "STALE" }; // 미래 시각도 불신
  const remainingPct = (i.availableSpaces / i.totalSpaces) * 100;
  const congestion = remainingPct >= cfg.relaxedAtOrAbovePct ? "RELAXED" : remainingPct < cfg.busyBelowPct ? "BUSY" : "NORMAL";
  return { status: "AVAILABLE", availableSpaces: i.availableSpaces, totalSpaces: i.totalSpaces, remainingPct, congestion, observedAt: i.observedAt };
}
