// 요금 계산 엔진 (순수 함수). docs/FEE_CALCULATION.md 원칙:
// 규칙이 불완전/충돌/미지원이면 임의 계산하지 않고 UNKNOWN 반환. 요금 데이터 없음은 0원이 아님.
import { DAY_MS, kstDayStart, kstWeekday, kstYmd } from "@/lib/time";

export type DayType = "WEEKDAY" | "SATURDAY" | "SUNDAY" | "HOLIDAY" | "EVERYDAY" | "UNKNOWN";
export type RuleType = "BASE" | "ADDITIONAL" | "DAILY_MAX" | "FREE";

export interface FeeRule {
  ruleType: RuleType;
  amount?: number | null;           // 원. null/undefined = 미확인
  durationMinutes?: number | null;
  dayType: DayType;
  startTime?: string | null;        // 'HH:MM' KST, 없으면 종일 (FREE 규칙에서만 지원)
  endTime?: string | null;          // '24:00' 허용. start > end 는 자정 통과 구간
  dailyMaxBasis?: "CALENDAR_DAY" | "ENTRY_24H" | "UNKNOWN" | null;
  id?: string | number;
}

export type FeeUnknownReason =
  | "INVALID_PERIOD" | "NO_RULES" | "HOLIDAY_DATA_MISSING" | "RULE_DAYTYPE_UNKNOWN" | "INVALID_RULE"
  | "RULE_CONFLICT" | "INCOMPLETE_RULE" | "UNSUPPORTED_RULE" | "UNSUPPORTED_RATE_CHANGE" | "UNSUPPORTED_DAILY_MAX_BASIS";

export interface FeeInput {
  startAt: Date;
  endAt: Date;
  rules: FeeRule[];
  /** KST 공휴일 'YYYY-MM-DD' 집합. null = 공휴일 데이터 미확보 */
  holidays: ReadonlySet<string> | null;
}
export interface DayBreakdown { date: string; dayType: DayType; minutes: number; freeMinutes: number; chargeableMinutes: number; fee: number; capped: boolean }
export type FeeResult =
  | { status: "OK"; amount: number; isFree: boolean; days: DayBreakdown[]; appliedRules: Array<string | number>; notes: string[]; assumptions: string[] }
  | { status: "UNKNOWN"; reason: FeeUnknownReason; detail: string }; // UI: 정확한 요금 계산 불가

const unknown = (reason: FeeUnknownReason, detail: string): FeeResult => ({ status: "UNKNOWN", reason, detail });

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && v <= 1440 ? v : null;
}
/** 분 단위 [start,end) 구간 목록 (0~1440). 자정 통과는 두 구간으로 분할. null = 형식 오류 */
function windows(r: FeeRule): Array<[number, number]> | null {
  if (r.startTime == null && r.endTime == null) return [[0, 1440]];
  if (r.startTime == null || r.endTime == null) return null;
  const s = parseHm(r.startTime), e = parseHm(r.endTime);
  if (s == null || e == null || s === e) return null;
  return s < e ? [[s, e]] : [[s, 1440], [0, e]];
}
function unionLength(ws: Array<[number, number]>, from: number, to: number): number {
  const clipped = ws.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, curEnd = -1, curStart = -1;
  for (const [a, b] of clipped) {
    if (a > curEnd) { if (curEnd > curStart) total += curEnd - curStart; curStart = a; curEnd = b; }
    else curEnd = Math.max(curEnd, b);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

interface Rate { baseAmount: number; baseMinutes: number; addAmount: number | null; addMinutes: number | null }
const fee = (m: number, r: Rate): number | null => {
  if (m <= 0) return 0;
  if (m <= r.baseMinutes) return r.baseAmount;
  if (r.addAmount == null || r.addMinutes == null) return null;
  return r.baseAmount + Math.ceil((m - r.baseMinutes) / r.addMinutes) * r.addAmount;
};

export function calculateFee(input: FeeInput): FeeResult {
  const s = input.startAt.getTime(), e = input.endAt.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return unknown("INVALID_PERIOD", "종료 시각은 시작 시각보다 늦어야 함");
  if (input.rules.length === 0) return unknown("NO_RULES", "요금 규칙 없음 (0원 아님)");

  const singleDay = kstDayStart(s) === kstDayStart(e - 1); // 종료 시각 직전까지 같은 KST 날짜(정확히 다음 자정 종료도 포함)

  // 규칙 검증
  for (const r of input.rules) {
    if (r.dayType === "UNKNOWN") return unknown("RULE_DAYTYPE_UNKNOWN", "적용 요일 구분이 불명확한 규칙 존재");
    if (r.ruleType === "FREE") {
      if (windows(r) === null) return unknown("INVALID_RULE", "무료 시간대 형식 오류");
      continue;
    }
    if (r.startTime != null || r.endTime != null) return unknown("UNSUPPORTED_RULE", "시간대별 요금 차등은 미지원");
    if (r.amount == null || !Number.isFinite(r.amount) || r.amount < 0) return unknown("INCOMPLETE_RULE", "금액 미확인 규칙");
    if (r.ruleType !== "DAILY_MAX" && (r.durationMinutes == null || !(r.durationMinutes > 0))) return unknown("INCOMPLETE_RULE", "단위 시간 미확인 규칙");
    if (r.ruleType === "DAILY_MAX" && r.dailyMaxBasis !== "CALENDAR_DAY") {
      // 기준이 '입차 24시간' 또는 '불명'이면, 달력일 해석과 24시간 해석이 같은 결과가 되는 경우(자정을 넘지 않는 단일 일자 이용)에만 상한으로 적용한다.
      // 사용자 결정(2026-11-08): 표준데이터 '1일주차권요금'을 이 방식으로 취급. 기준 필드 자체가 없으면(null/undefined) 계속 계산 불가.
      const okBasis = r.dailyMaxBasis === "UNKNOWN" || r.dailyMaxBasis === "ENTRY_24H";
      if (!okBasis || !singleDay) {
        return unknown("UNSUPPORTED_DAILY_MAX_BASIS", "일일 최대요금 기준(날짜 경계)이 확인되지 않았고 자정을 넘기는 이용이라 계산 불가");
      }
    }
  }
  if (input.holidays === null && input.rules.some((r) => r.dayType !== "EVERYDAY")) {
    return unknown("HOLIDAY_DATA_MISSING", "공휴일 데이터가 없어 요일별 규칙 적용 불가");
  }

  const days: DayBreakdown[] = [];
  const applied = new Set<string | number>();
  let rate: Rate | null = null;
  const perDay: Array<{ d: DayBreakdown; chargeable: number; dailyMax: number | null; assumedBasis: boolean }> = [];

  for (let ds = kstDayStart(s); ds < e; ds += DAY_MS) {
    const a = Math.max(s, ds), b = Math.min(e, ds + DAY_MS);
    const ymd = kstYmd(ds);
    const wd = kstWeekday(ds);
    const dayType: DayType = input.holidays?.has(ymd) ? "HOLIDAY" : wd === 0 ? "SUNDAY" : wd === 6 ? "SATURDAY" : "WEEKDAY";
    const pick = (t: RuleType) => {
      const specific = input.rules.filter((r) => r.ruleType === t && r.dayType === dayType);
      return specific.length ? specific : input.rules.filter((r) => r.ruleType === t && r.dayType === "EVERYDAY");
    };
    // 무료 시간대: 해당 요일 규칙 + 매일 규칙의 합집합
    const freeRules = input.rules.filter((r) => r.ruleType === "FREE" && (r.dayType === dayType || r.dayType === "EVERYDAY"));
    const freeWs = freeRules.flatMap((r) => windows(r)!);
    const fromMin = (a - ds) / 60000, toMin = (b - ds) / 60000;
    const minutes = toMin - fromMin;
    const freeMinutes = unionLength(freeWs, fromMin, toMin);
    const chargeable = minutes - freeMinutes;
    freeRules.forEach((r) => r.id != null && applied.add(r.id));

    let dailyMax: number | null = null, assumedBasis = false;
    if (chargeable > 0) {
      const base = pick("BASE"), add = pick("ADDITIONAL"), dm = pick("DAILY_MAX");
      if (base.length === 0) return unknown("INCOMPLETE_RULE", `${ymd}: 기본요금 규칙 없음 (유료 구간 존재)`);
      const same = (rs: FeeRule[]) => rs.every((r) => r.amount === rs[0].amount && r.durationMinutes === rs[0].durationMinutes);
      if (!same(base) || !same(add) || dm.some((r) => r.amount !== dm[0].amount)) return unknown("RULE_CONFLICT", `${ymd}: 동일 유형 규칙 간 값 충돌`);
      const r: Rate = { baseAmount: base[0].amount!, baseMinutes: base[0].durationMinutes!, addAmount: add[0]?.amount ?? null, addMinutes: add[0]?.durationMinutes ?? null };
      if (rate && JSON.stringify(rate) !== JSON.stringify(r)) return unknown("UNSUPPORTED_RATE_CHANGE", "기간 중 요금 단가가 달라지는 경우(평일↔주말 등 유료 구간 혼합)는 미지원");
      rate = r;
      dailyMax = dm.length ? dm[0].amount! : null;
      assumedBasis = dm.length > 0 && dm[0].dailyMaxBasis !== "CALENDAR_DAY";
      [...base, ...add, ...dm].forEach((x) => x.id != null && applied.add(x.id));
    }
    const d: DayBreakdown = { date: ymd, dayType, minutes, freeMinutes, chargeableMinutes: chargeable, fee: 0, capped: false };
    days.push(d);
    perDay.push({ d, chargeable, dailyMax, assumedBasis });
  }

  // 누적 유료 시간 기준 요금의 일별 증분을 일일 최대로 제한
  let cum = 0, prevFee = 0, total = 0;
  const assumptions: string[] = [];
  for (const { d, chargeable, dailyMax, assumedBasis } of perDay) {
    if (chargeable <= 0 || !rate) continue;
    cum += chargeable;
    const f = fee(cum, rate);
    if (f === null) return unknown("INCOMPLETE_RULE", "기본 단위 초과분의 추가요금 규칙 없음");
    let inc = f - prevFee;
    prevFee = f;
    if (dailyMax != null && inc > dailyMax) {
      inc = dailyMax; d.capped = true;
      // 상한이 실제로 요금을 낮춘 경우에만 '추정'으로 표시(상한이 걸리지 않으면 결과에 영향 없음)
      if (assumedBasis && assumptions.length === 0) assumptions.push("1일권 요금을 일일 최대요금으로 간주한 추정입니다(자정을 넘지 않는 이용에 한함, 실제 판매·적용 여부는 현장 확인 필요)");
    }
    d.fee = inc;
    total += inc;
  }
  const notes = ["일일 최대요금은 달력일(KST 00:00) 기준으로 적용", "단위 시간 올림은 전체 이용 구간 누적 기준 (날짜 경계에서 분할하지 않음)"];
  return { status: "OK", amount: total, isFree: total === 0, days, appliedRules: [...applied], notes, assumptions };
}
