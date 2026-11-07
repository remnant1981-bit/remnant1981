// 시간대: 저장은 UTC, 표시·요일·날짜 경계 판단은 Asia/Seoul(UTC+9, 서머타임 없음).
export const KST_OFFSET_MS = 9 * 3600_000;
export const DAY_MS = 86400_000;

/** 인스턴트가 속한 KST 날짜의 시작(00:00 KST) epoch ms */
export function kstDayStart(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}
/** KST 기준 YYYY-MM-DD */
export function kstYmd(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}
/** KST 요일 (0=일 … 6=토) */
export function kstWeekday(ms: number): number {
  return new Date(ms + KST_OFFSET_MS).getUTCDay();
}
