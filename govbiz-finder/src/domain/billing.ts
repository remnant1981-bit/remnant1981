// 요금제 신청 금액·기간 계산(화면·서버 공용). 금액은 항상 서버에서 다시 계산해 저장한다.
import { PLANS, type PlanId } from "./plans";

export type Cycle = "monthly" | "yearly";
export const CYCLES: Record<Cycle, { label: string; months: number }> = {
  monthly: { label: "월 결제", months: 1 },
  yearly: { label: "연 결제(2개월 할인)", months: 12 },
};
export const TRIAL_DAYS = 14;
export const TEAM_BASE_SEATS = 5;
export const EXTRA_SEAT_MONTHLY = 5000;
export const VAT_RATE = 0.1;
export type PaidPlanId = Exclude<PlanId, "free">;
export const PAID_PLAN_IDS: PaidPlanId[] = ["pro", "team"];

/** 요금제별 허용 인원: Pro 1명 고정, Team 5~100명 */
export function seatRange(plan: PaidPlanId): { min: number; max: number } {
  return plan === "team" ? { min: TEAM_BASE_SEATS, max: 100 } : { min: 1, max: 1 };
}

export interface Quote { plan: PaidPlanId; cycle: Cycle; seats: number; months: number; base: number; extraSeats: number; extra: number; supply: number; vat: number; total: number }

/** 연 결제는 기본 요금·추가 인원 모두 10개월분(2개월 할인). 부가세 10%(원 미만 버림) */
export function quote(plan: PaidPlanId, cycle: Cycle, seats: number): Quote {
  const def = PLANS[plan];
  const months = CYCLES[cycle].months;
  const base = cycle === "yearly" ? def.priceYearly : def.priceMonthly;
  const extraSeats = plan === "team" ? Math.max(0, seats - TEAM_BASE_SEATS) : 0;
  const extra = extraSeats * EXTRA_SEAT_MONTHLY * (cycle === "yearly" ? 10 : 1);
  const supply = base + extra;
  const vat = Math.floor(supply * VAT_RATE);
  return { plan, cycle, seats, months, base, extraSeats, extra, supply, vat, total: supply + vat };
}

const toDate = (ymd: string) => new Date(ymd + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(ymd: string, n: number): string {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
/** 월 더하기(말일 보정: 1/31 + 1개월 → 2/28 또는 2/29) */
export function addMonths(ymd: string, n: number): string {
  const d = toDate(ymd);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}
/** 체험 종료일(시작일 포함 14일) */
export const trialEnd = (today: string) => addDays(today, TRIAL_DAYS - 1);
/**
 * 결제 이용 종료일. 같은 요금제가 아직 유효하면 기존 종료일 다음 날부터 연장, 아니면 오늘부터.
 * 예) 2026-11-13 월 결제 → 2026-12-12까지
 */
export function paidPeriod(today: string, months: number, currentPaidUntil: string | null): { start: string; end: string } {
  const start = currentPaidUntil && currentPaidUntil >= today ? addDays(currentPaidUntil, 1) : today;
  return { start, end: addDays(addMonths(start, months), -1) };
}
