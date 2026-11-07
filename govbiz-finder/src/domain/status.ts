import { daysBetween, isValidYmd } from "@/lib/time";

export type AppStatus = "upcoming" | "open" | "closed" | "always" | "unknown";

/**
 * 접수 상태 계산. 날짜만으로 추정한 값은 basis='estimated' (원문 확인 상태와 구분).
 * confirmedStatus 가 주어지면(원문에서 확인) 그대로 사용.
 */
export function computeStatus(
  start: string | null,
  end: string | null,
  today: string,
  confirmedStatus?: AppStatus | null,
): { status: AppStatus; basis: "confirmed" | "estimated" } {
  if (confirmedStatus && confirmedStatus !== "unknown") return { status: confirmedStatus, basis: "confirmed" };
  const s = isValidYmd(start) ? start : null;
  const e = isValidYmd(end) ? end : null;
  if (!s && !e) return { status: "unknown", basis: "estimated" };
  if (e && today > e) return { status: "closed", basis: "estimated" };
  if (s && today < s) return { status: "upcoming", basis: "estimated" };
  if (e || s) return { status: "open", basis: "estimated" };
  return { status: "unknown", basis: "estimated" };
}

/** 마감 임박 여부(접수 중이며 D-day 가 days 이하). */
export function deadlineDays(end: string | null, today: string): number | null {
  if (!isValidYmd(end)) return null;
  return daysBetween(today, end);
}
export function isDeadlineSoon(status: string, end: string | null, today: string, days = 7): boolean {
  if (status !== "open") return false;
  const d = deadlineDays(end, today);
  return d !== null && d >= 0 && d <= days;
}
