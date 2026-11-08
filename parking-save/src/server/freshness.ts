import { STANDARD_SOURCE } from "@/collector/standard-api";

/** 기준일 경과 일수가 이 값을 넘으면 '오래된 데이터'로 표시(출처별). 기본 7일은 실시간 계열용 임시값. */
export const DEFAULT_STALE_DAYS = 7;
/**
 * 표준데이터: 지자체가 반기 단위로 일괄 제출하는 패턴(실표본 기준일 경과 11~208일, 중앙 180일)이라 7일은 부적합 → 365일(사용자 결정 2026-11-08).
 * STANDARD_SAMPLE은 같은 형식의 픽스처.
 */
const STALE_DAYS_BY_SOURCE: Record<string, number> = { [STANDARD_SOURCE]: 365, STANDARD_SAMPLE: 365 };
export const staleDaysFor = (source: string): number => STALE_DAYS_BY_SOURCE[source] ?? DEFAULT_STALE_DAYS;
