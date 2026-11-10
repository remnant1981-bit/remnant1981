import { DAY_MS, kstWeekday, kstYmd, kstDayStart } from "@/lib/time";
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

/**
 * 이용 구간 [start, end) 전체 기준 판정. 입차·출차 시각뿐 아니라 구간 안의 모든 개·폐장 시각(경계)에서도 운영 중이어야 OPERATING.
 * - 하나라도 운영 외 → OUTSIDE(예: 09–18시 시설에 10:00~익일 10:00 주차는 중간에 폐장), 판정 불가가 있으면 UNKNOWN.
 * - 종료 시각 정각은 구간에 포함하지 않음(18시 폐장 시설에 16–18시 주차는 운영).
 */
export function operatingForStay(rows: ScheduleRow[], startMs: number, endMs: number, holidays: ReadonlySet<string> | null): OperatingStatus {
  const last = endMs - 1; // 구간의 마지막 순간
  const points = new Set<number>([startMs, Math.max(startMs, last)]);
  for (let ds = kstDayStart(startMs); ds <= last; ds += DAY_MS) {
    points.add(ds); // 자정(날짜가 바뀌며 적용 규칙이 달라질 수 있음)
    const use = pickRows(rows, ds, holidays);
    for (const r of use ?? []) for (const t of [hm(r.openTime), hm(r.closeTime)]) if (t != null) points.add(ds + t * 60000);
  }
  let sawOutside = false;
  for (const t of points) {
    if (t < startMs || t > last) continue;
    const st = operatingAt(rows, t, holidays);
    if (st === "UNKNOWN") return "UNKNOWN";
    if (st === "OUTSIDE") sawOutside = true;
  }
  return sawOutside ? "OUTSIDE" : "OPERATING";
}
