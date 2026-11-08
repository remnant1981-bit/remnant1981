import type { FeeView, LotItem } from "@/server/search";

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export const distLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);

export const TYPE_LABEL = { ON_STREET: "노상", OFF_STREET: "노외", UNKNOWN: "유형 미확인" } as const;
export const OWNERSHIP_LABEL = { PUBLIC: "공영", UNKNOWN: "공영 여부 미확인" } as const;
export const OPERATING_LABEL = { OPERATING: "운영", OUTSIDE: "운영 외 시간", UNKNOWN: "운영 확인 불가" } as const;
export const DAY_LABEL: Record<string, string> = { WEEKDAY: "평일", SATURDAY: "토요일", SUNDAY: "일요일", HOLIDAY: "공휴일", EVERYDAY: "매일", UNKNOWN: "미상" };
export const RULE_LABEL: Record<string, string> = { BASE: "기본요금", ADDITIONAL: "추가요금", DAILY_MAX: "일일 최대요금", FREE: "무료", SEASON_PASS: "정기권", OTHER: "기타" };

export const FEE_REASON_LABEL: Record<string, string> = {
  NO_RULES: "요금 정보 없음",
  HOLIDAY_DATA_MISSING: "공휴일 데이터가 없어 계산 불가",
  RULE_DAYTYPE_UNKNOWN: "요금 규칙이 불명확해 계산 불가",
  INCOMPLETE_RULE: "요금 규칙이 불완전해 계산 불가",
  RULE_CONFLICT: "요금 규칙이 충돌해 계산 불가",
  UNSUPPORTED_RULE: "지원되지 않는 요금 규칙 — 계산 불가",
  UNSUPPORTED_RATE_CHANGE: "기간 중 요금 단가가 달라져 계산 불가",
  UNSUPPORTED_DAILY_MAX_BASIS: "일일 최대요금 기준 미확인 — 계산 불가",
  INVALID_RULE: "요금 규칙 형식 오류 — 계산 불가",
  INVALID_PERIOD: "주차 기간 오류",
};
export function feeText(f: FeeView): { main: string; sub?: string; tone: "free" | "paid" | "unknown" } {
  if (f.status === "OK") return f.isFree ? { main: "무료", sub: "시설 규칙상 입력 시간 전체 무료", tone: "free" } : { main: `예상 ${won(f.amount!)}`, sub: f.assumptions?.[0] ? "1일권 요금 상한 적용(추정)" : undefined, tone: "paid" };
  return { main: "요금 정보 없음", sub: FEE_REASON_LABEL[f.reason ?? ""] ?? "정확한 요금 계산 불가", tone: "unknown" };
}
export function occupancyText(o: LotItem["occupancy"]): { main: string; sub?: string } {
  if (o.status === "UNAVAILABLE") return { main: "실시간 확인 불가" };
  const c = { RELAXED: "여유", NORMAL: "보통", BUSY: "혼잡" }[o.congestion];
  return { main: `잔여 ${o.availableSpaces}면 / 전체 ${o.totalSpaces}면`, sub: `${c} · ${new Date(o.observedAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })} 기준` };
}

/** 출처 표시명: 목업/샘플은 실데이터가 아님을 명시 */
export function sourceLabel(name: string): string {
  if (name === "MOCK") return "목업(가상 데이터 — 실제 주차장 아님)";
  if (name === "STANDARD_SAMPLE") return "전국주차장정보표준데이터 샘플(검증 전 일부 행)";
  return name;
}
