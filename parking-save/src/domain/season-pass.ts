// 월정기권 안내(순수 함수). 원천의 '월정기권요금'은 금액만 있고 판매 여부·자격(거주자·직장인 등)·대기 여부는 없으므로
// 금액 비교만 안내하고 '살 수 있다'고 단정하지 않는다.
export const PASS_HINT_MIN_DAYS = 7;

export type PassHint =
  | { kind: "CHEAPER"; pass: number; fee: number }   // 예상 요금이 정기권보다 비쌈
  | { kind: "CHECK"; pass: number };                 // 요금 계산 불가인 장기 이용 — 정기권도 확인 권장

export function seasonPassHint(input: { pass: number | null; stayMinutes: number; fee: number | null }): PassHint | null {
  const { pass, stayMinutes, fee } = input;
  if (pass == null || !(pass > 0) || stayMinutes < PASS_HINT_MIN_DAYS * 1440) return null;
  if (fee == null) return { kind: "CHECK", pass };
  return fee > pass ? { kind: "CHEAPER", pass, fee } : null;
}
