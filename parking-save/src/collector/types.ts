export type RawRow = Record<string, string | null | undefined>;
export interface RawRecord { sourceRecordId: string; row: RawRow }

/** 원천 어댑터: 원천별 API 변경이 도메인 로직에 전파되지 않도록 분리 (ARCHITECTURE.md) */
export interface SourceAdapter {
  readonly sourceName: string;
  /** 원천 데이터 기준 시각(알 수 있을 때) */
  fetch(): AsyncIterable<RawRow>;
}

export interface NormalizedFeeRule {
  ruleType: "BASE" | "ADDITIONAL" | "DAILY_MAX" | "FREE" | "SEASON_PASS";
  amount: number | null; durationMinutes: number | null;
  dayType: "WEEKDAY" | "SATURDAY" | "SUNDAY" | "HOLIDAY" | "EVERYDAY";
  dailyMaxBasis: "CALENDAR_DAY" | "ENTRY_24H" | "UNKNOWN" | null;
}
export interface NormalizedSchedule {
  dayType: "WEEKDAY" | "SATURDAY" | "SUNDAY" | "HOLIDAY" | "EVERYDAY";
  openTime: string | null; closeTime: string | null; allDay: boolean;
}
export interface NormalizedLot {
  sourceRecordId: string; name: string; operatorName: string | null;
  parkingType: "ON_STREET" | "OFF_STREET" | "UNKNOWN"; ownershipType: "PUBLIC" | "UNKNOWN";
  address: string | null; roadAddress: string | null; latitude: number | null; longitude: number | null;
  totalSpaces: number | null; phone: string | null; sourceUpdatedAt: string | null;
  qualityFlags: string[]; feeRules: NormalizedFeeRule[]; schedules: NormalizedSchedule[];
}
export type NormalizeResult =
  | { kind: "ok"; lot: NormalizedLot }
  | { kind: "excluded"; reason: "PRIVATE" | "ATTACHED_OR_OTHER_TYPE" }  // MVP 범위 밖(민영·부설)
  | { kind: "invalid"; reason: "MISSING_KEY" | "MISSING_NAME" };         // 저장 불가
