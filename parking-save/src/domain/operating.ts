import { kstWeekday, kstYmd, kstDayStart } from "@/lib/time";
import type { DayType } from "./fee";

export interface ScheduleRow {
  dayType: DayType; openTime: string | null; closeTime: string | null; allDay: boolean | null; closed: boolean | null;
}
export type OperatingStatus = "OPERATING" | "OUTSIDE" | "UNKNOWN"; // UI: 운영 / 운영 외 / 확인 불가

const hm = (s: string | null): number | null => {
  const m = s && /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 한 시점의 운영 여부. 데이터 미기재는 24시간 운영이 아님 → UNKNOWN */
export function operatingAt(rows: ScheduleRow[], ms: number, holidays: ReadonlySet<string> | null): OperatingStatus {
  if (rows.length === 0) return "UNKNOWN";
  if (holidays === null && rows.some((r) => r.dayType !== "EVERYDAY")) return "UNKNOWN";
  const ymd = kstYmd(ms), wd = kstWeekday(ms);
  const dt: DayType = holidays?.has(ymd) ? "HOLIDAY" : wd === 0 ? "SUNDAY" : wd === 6 ? "SATURDAY" : "WEEKDAY";
  const specific = rows.filter((r) => r.dayType === dt);
  const use = specific.length ? specific : rows.filter((r) => r.dayType === "EVERYDAY");
  if (use.length === 0 || rows.some((r) => r.dayType === "UNKNOWN")) return "UNKNOWN";
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
