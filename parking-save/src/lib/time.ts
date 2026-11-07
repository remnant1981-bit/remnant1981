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

/** ISO 8601 (오프셋 필수, 예: 2026-11-09T10:00:00+09:00 / Z). 오프셋 없는 값은 null */
export function parseOffsetIso(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
/** <input type=datetime-local> 값(YYYY-MM-DDTHH:mm)을 KST로 해석해 ISO 오프셋 문자열로 */
export function kstLocalToIso(s: string | undefined | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  return `${s}:00+09:00`;
}
/** epoch ms → datetime-local 값 (KST) */
export function toKstLocalInput(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16);
}
export function formatKst(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** 검색 폼 기본값: 다음 15분 단위 시각부터 2시간 (KST datetime-local 값) */
export function defaultStayInputs(nowMs: number = Date.now()): { start: string; end: string } {
  const s = Math.ceil(nowMs / 900000) * 900000;
  return { start: toKstLocalInput(s), end: toKstLocalInput(s + 2 * 3600_000) };
}
