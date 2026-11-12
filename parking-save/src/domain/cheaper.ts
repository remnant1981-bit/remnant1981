// 더 싼 시간대 제안(순수 함수). 같은 이용 시간을 앞뒤로 옮겼을 때 같은 주차장이 더 싸지는 경우만 찾는다.
// 원칙: 요금·운영 판정이 모두 확인된 대안만 제안(계산 불가·운영 외는 제외), 지난 시각으로 옮기는 제안은 하지 않음.
import { calculateFee, type FeeRule } from "./fee";
import { operatingForStay, type ScheduleRow } from "./operating";

export const SHIFT_MINUTES = [-60, -30, 30, 60] as const;
/** 이 금액 이상 아낄 때만 제안(소액 차이는 안내 가치가 낮음) */
export const MIN_SAVING_WON = 300;

export interface CheaperShift { shiftMinutes: number; startAt: string; endAt: string; fee: number; saving: number }

export function cheaperShifts(input: {
  rules: FeeRule[]; schedules: ScheduleRow[]; holidays: ReadonlySet<string> | null;
  startAt: Date; endAt: Date; now: Date; baseFee: number;
}): CheaperShift[] {
  const { rules, schedules, holidays, startAt, endAt, now, baseFee } = input;
  const out: CheaperShift[] = [];
  for (const m of SHIFT_MINUTES) {
    const s = startAt.getTime() + m * 60_000, e = endAt.getTime() + m * 60_000;
    if (s < now.getTime()) continue;
    const r = calculateFee({ startAt: new Date(s), endAt: new Date(e), rules, holidays });
    if (r.status !== "OK") continue;
    if (schedules.length > 0 && operatingForStay(schedules, s, e, holidays) !== "OPERATING") continue;
    const saving = baseFee - r.amount;
    if (saving >= MIN_SAVING_WON) out.push({ shiftMinutes: m, startAt: new Date(s).toISOString(), endAt: new Date(e).toISOString(), fee: r.amount, saving });
  }
  // 많이 아끼는 순, 같으면 덜 옮기는 순. 최대 2개
  return out.sort((a, b) => b.saving - a.saving || Math.abs(a.shiftMinutes) - Math.abs(b.shiftMinutes)).slice(0, 2);
}
