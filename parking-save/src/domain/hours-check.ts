// 운영시간 이상치 점검(원천 입력 오류 의심). 계산을 바꾸지 않고 품질 리포트에만 쓴다.
// 자정을 넘기는 운영(예: 18:00~05:00)은 정상으로 본다(실데이터 56건, 야간 개방 주차장).
export type HoursAnomaly = "OPEN_EQ_CLOSE" | "UNDER_1H" | "TIME_FORMAT";
export const HOURS_ANOMALY_LABEL: Record<HoursAnomaly, string> = { OPEN_EQ_CLOSE: "여는 시각과 닫는 시각이 같음", UNDER_1H: "운영시간이 1시간 미만", TIME_FORMAT: "시각 형식 오류" };
const hm = (s: string | null) => { const m = s && /^(\d{1,2}):(\d{2})$/.exec(s); return m && +m[1] <= 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };

export function hoursAnomaly(s: { openTime: string | null; closeTime: string | null; allDay: boolean | null; closed: boolean | null }): HoursAnomaly | null {
  if (s.closed || s.allDay) return null;
  const o = hm(s.openTime), c = hm(s.closeTime);
  if (o == null || c == null) return "TIME_FORMAT";
  if (o === c) return "OPEN_EQ_CLOSE";
  const span = c > o ? c - o : c + 1440 - o;
  return span < 60 ? "UNDER_1H" : null;
}
