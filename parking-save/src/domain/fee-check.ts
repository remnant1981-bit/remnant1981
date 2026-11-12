// 요금 이상치 점검과 감면 안내(순수 함수).
// 이상치: 원천 입력 오류로 보이는 값만 표시(계산은 그대로 하되 '확인 필요' 경고, 최저가 강조에서 제외). 기준은 실데이터 분포로 정함:
//   시간당 요금 상위 1%가 약 8,000원(최대 6만 원) → 2만 원 초과는 명백한 이상. 추가/기본 단가 비율 상위 1%가 약 13배 → 15배 초과.
// 감면: 특기사항 원문의 대상 키워드만 찾아 안내. 금액에는 반영하지 않음(조건·증빙이 시설마다 달라 추정 금지).
import type { FeeRule } from "./fee";

export const FEE_CHECK = { maxHourly: 20_000, maxAddToBaseRatio: 15 } as const;
export type FeeAnomaly = "HOURLY_TOO_HIGH" | "ADD_RATE_JUMP" | "DAILY_MAX_BELOW_HOUR";
export const FEE_ANOMALY_LABEL: Record<FeeAnomaly, string> = {
  HOURLY_TOO_HIGH: "시간당 요금이 비정상적으로 높음",
  ADD_RATE_JUMP: "추가요금 단가가 기본요금보다 지나치게 높음",
  DAILY_MAX_BELOW_HOUR: "일 최대요금이 1시간 요금보다 낮음",
};

const hourly = (r: FeeRule | undefined) => (r && r.amount != null && r.durationMinutes && r.durationMinutes > 0 ? (r.amount / r.durationMinutes) * 60 : null);

export function feeAnomalies(rules: FeeRule[]): FeeAnomaly[] {
  const out = new Set<FeeAnomaly>();
  // 요일별로 따로 검사(평일·주말 규칙이 섞여 비교되지 않게)
  const days = new Set(rules.map((r) => r.dayType));
  for (const day of days) {
    const pick = (t: FeeRule["ruleType"]) => rules.find((r) => r.ruleType === t && r.dayType === day);
    const base = pick("BASE"), add = pick("ADDITIONAL"), dm = pick("DAILY_MAX");
    const bh = hourly(base), ah = hourly(add);
    if ((bh ?? 0) > FEE_CHECK.maxHourly || (ah ?? 0) > FEE_CHECK.maxHourly) out.add("HOURLY_TOO_HIGH");
    if (bh && ah && bh > 0 && ah / bh > FEE_CHECK.maxAddToBaseRatio) out.add("ADD_RATE_JUMP");
    if (dm?.amount != null && base?.amount != null && base.durationMinutes) {
      // 1시간 이용 요금(기본 + 남는 시간의 추가요금 올림)
      const rest = Math.max(0, 60 - base.durationMinutes);
      const oneHour = base.amount + (rest > 0 && add?.amount != null && add.durationMinutes ? Math.ceil(rest / add.durationMinutes) * add.amount : 0);
      if (dm.amount > 0 && dm.amount < oneHour) out.add("DAILY_MAX_BELOW_HOUR");
    }
  }
  return [...out];
}

/** 특기사항에서 감면·할인 대상 찾기(표시 순서 고정) */
const DISCOUNT_TARGETS: Array<[string, RegExp]> = [
  ["경차", /경차|경형/], ["저공해·친환경차", /저공해|친환경|전기차|수소차|하이브리드/], ["장애인", /장애인/],
  ["국가유공자", /유공자|보훈/], ["다자녀", /다자녀|다둥이/], ["임산부", /임산부|임신부/],
];
export function discountTargets(note: string | null | undefined): string[] {
  if (!note || !/감면|할인|면제|50\s*(%|프로|퍼센트)|무료/.test(note)) return [];
  return DISCOUNT_TARGETS.filter(([, re]) => re.test(note)).map(([label]) => label);
}
