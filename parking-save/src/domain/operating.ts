import { kstWeekday, kstYmd, kstDayStart } from "@/lib/time";
import type { DayType } from "./fee";

export interface ScheduleRow {
  dayType: DayType; openTime: string | null; closeTime: string | null; allDay: boolean | null; closed: boolean | null;
  /** 정책으로 채운 추정 규칙(일요일에 공휴일 규칙 적용 등) */
  assumed?: boolean;
}
export type OperatingStatus = "OPERATING" | "OUTSIDE" | "UNKNOWN"; // UI: 운영 / 운영 외 / 확인 불가

const hm = (s: string | null): number | null => {
  const m = s && /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 그 시점에 적용되는 일정 행. 판정 불가면 null */
function pickRows(rows: ScheduleRow[], ms: number, holidays: ReadonlySet<string> | null): ScheduleRow[] | null {
  if (rows.length === 0) return null;
  if (holidays === null && rows.some((r) => r.dayType !== "EVERYDAY")) return null;
  const ymd = kstYmd(ms), wd = kstWeekday(ms);
  const dt: DayType = holidays?.has(ymd) ? "HOLIDAY" : wd === 0 ? "SUNDAY" : wd === 6 ? "SATURDAY" : "WEEKDAY";
  const specific = rows.filter((r) => r.dayType === dt);
  const use = specific.length ? specific : rows.filter((r) => r.dayType === "EVERYDAY");
  if (use.length === 0 || rows.some((r) => r.dayType === "UNKNOWN")) return null;
  return use;
}

/** 입·출차 시각 판정에 추정 규칙(예: 일요일에 공휴일 규칙)이 쓰였는지 */
export function operatingUsesAssumed(rows: ScheduleRow[], startMs: number, endMs: number, holidays: ReadonlySet<string> | null): boolean {
  return [startMs, endMs].some((ms) => pickRows(rows, ms, holidays)?.some((r) => r.assumed) ?? false);
}

/** 한 시점의 운영 여부. 데이터 미기재는 24시간 운영이 아님 → UNKNOWN */
export function operatingAt(rows: ScheduleRow[], ms: number, holidays: ReadonlySet<string> | null): OperatingStatus {
  const use = pickRows(rows, ms, holidays);
  if (!use) return "UNKNOWN";
  const minute = Math.floor((ms - kstDayStart(ms)) / 60000);
  let sawOutside = false;
  for (const r of use) {
    if (r.closed) { sawOutside = true; continue; }
    if (r.allDay) return "OPERATING";
    const o = hm(r.openTime), c = hm(r.closeTime);
    if (o == null || c == null || o === c) return "UNKNOWN";
    const open = o < c ? minute >= o && minute < c : minute >= o || minute < c;
    if (open) return "OPERATING";
    sawOutside = true;
  }
  return sawOutside ? "OUTSIDE" : "UNKNOWN";
}

/** 입차·출차 시각 기준 판정(중간 운영 중단은 미검사) */
export function operatingForStay(rows: ScheduleRow[], startMs: number, endMs: number, holidays: ReadonlySet<string> | null): OperatingStatus {
  const a = operatingAt(rows, startMs, holidays), b = operatingAt(rows, endMs, holidays);
  if (a === "UNKNOWN" || b === "UNKNOWN") return "UNKNOWN";
  return a === "OPERATING" && b === "OPERATING" ? "OPERATING" : "OUTSIDE";
}
