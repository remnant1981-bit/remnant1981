// 전국주차장정보표준데이터(공공데이터포털 15012896) 행 → 내부 모델 정규화.
// 필드명은 포털 공개 페이지(2026-11-07 확인)의 컬럼 목록 기준. OpenAPI 호출 규격·인증·제한은 미검증.
// 원칙: 값이 없거나 해석 불가하면 NULL/규칙 미생성 + quality flag. 무료·24시간으로 추정하지 않는다.
import type { NormalizeResult, NormalizedFeeRule, NormalizedLot, NormalizedSchedule, RawRow } from "./types";

const s = (v: string | null | undefined) => (v == null ? "" : String(v).trim());
const nz = (v: string) => (v === "" ? null : v);

function num(v: string, flags: string[], flag: string): number | null {
  if (v === "") return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) { flags.push(flag); return null; }
  return n;
}
const hm = (v: string) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v.padStart(5, "0") : v === "24:00" ? v : null);

export function normalizeStandardRow(row: RawRow): NormalizeResult {
  const key = s(row["주차장관리번호"]);
  if (!key) return { kind: "invalid", reason: "MISSING_KEY" };
  const name = s(row["주차장명"]);
  if (!name) return { kind: "invalid", reason: "MISSING_NAME" };
  const flags: string[] = [];

  const kind = s(row["주차장구분"]);
  if (kind === "민영") return { kind: "excluded", reason: "PRIVATE" };
  let ownership: NormalizedLot["ownershipType"] = "UNKNOWN";
  if (kind === "공영") ownership = "PUBLIC"; else flags.push("OWNERSHIP_UNVERIFIED"); // 공영 여부 불명 → 단정 금지

  const t = s(row["주차장유형"]);
  if (t === "부설" || (t !== "" && t !== "노상" && t !== "노외")) return { kind: "excluded", reason: "ATTACHED_OR_OTHER_TYPE" };
  const parkingType: NormalizedLot["parkingType"] = t === "노상" ? "ON_STREET" : t === "노외" ? "OFF_STREET" : "UNKNOWN";
  if (parkingType === "UNKNOWN") flags.push("TYPE_UNKNOWN");

  // 좌표: 대한민국 범위 밖이면 사용하지 않음(위·경도 뒤바뀜 포함)
  let lat = num(s(row["위도"]), flags, "COORD_INVALID"), lng = num(s(row["경도"]), flags, "COORD_INVALID");
  if (lat == null || lng == null) { if (!flags.includes("COORD_INVALID")) flags.push("COORD_MISSING"); lat = lng = null; }
  else if (lat < 33 || lat > 39 || lng < 124 || lng > 132) { flags.push("COORD_OUT_OF_RANGE"); lat = lng = null; }

  const spaces = num(s(row["주차구획수"]), flags, "SPACES_INVALID");
  const totalSpaces = spaces != null && Number.isInteger(spaces) ? spaces : (spaces != null ? (flags.push("SPACES_INVALID"), null) : null);

  const baseDate = s(row["데이터기준일자"]);
  let sourceUpdatedAt: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(baseDate) && !Number.isNaN(Date.parse(baseDate))) sourceUpdatedAt = new Date(`${baseDate}T00:00:00+09:00`).toISOString();
  else flags.push("SOURCE_DATE_MISSING");

  return {
    kind: "ok",
    lot: {
      sourceRecordId: key, name, operatorName: nz(s(row["관리기관명"])), parkingType, ownershipType: ownership,
      address: nz(s(row["소재지지번주소"])), roadAddress: nz(s(row["소재지도로명주소"])), latitude: lat, longitude: lng,
      totalSpaces, phone: nz(s(row["전화번호"])), feeNote: nz(s(row["특기사항"]).slice(0, 300)), sourceUpdatedAt, qualityFlags: flags,
      feeRules: mapFees(row, flags), schedules: mapSchedules(row, flags),
    },
  };
}

function mapFees(row: RawRow, flags: string[]): NormalizedFeeRule[] {
  const kind = s(row["요금정보"]);
  const baseMin = num(s(row["주차기본시간"]), flags, "FEE_VALUE_INVALID"), baseAmt = num(s(row["주차기본요금"]), flags, "FEE_VALUE_INVALID");
  const addMin = num(s(row["추가단위시간"]), flags, "FEE_VALUE_INVALID"), addAmt = num(s(row["추가단위요금"]), flags, "FEE_VALUE_INVALID");
  const dayAmt = num(s(row["1일주차권요금"]), flags, "FEE_VALUE_INVALID"), dayHours = num(s(row["1일주차권요금적용시간"]), flags, "FEE_VALUE_INVALID");
  const monthly = num(s(row["월정기권요금"]), flags, "FEE_VALUE_INVALID");
  const out: NormalizedFeeRule[] = [];

  if (kind === "무료") {
    if ((baseAmt ?? 0) > 0 || (addAmt ?? 0) > 0 || (dayAmt ?? 0) > 0) { flags.push("FEE_CONFLICT"); return out; } // 무료인데 요금 기재 → 추정 금지
    out.push({ ruleType: "FREE", amount: null, durationMinutes: null, dayType: "EVERYDAY", dailyMaxBasis: null });
  } else if (kind === "유료") {
    if (baseMin == null || baseMin <= 0 || baseAmt == null) { flags.push("FEE_INCOMPLETE"); }
    else {
      out.push({ ruleType: "BASE", amount: baseAmt, durationMinutes: baseMin, dayType: "EVERYDAY", dailyMaxBasis: null });
      if (addMin != null && addMin > 0 && addAmt != null) out.push({ ruleType: "ADDITIONAL", amount: addAmt, durationMinutes: addMin, dayType: "EVERYDAY", dailyMaxBasis: null });
      else flags.push("FEE_NO_ADDITIONAL");
      // 1일주차권: 날짜 경계·적용 방식이 원천에 명시되지 않음(OPEN_ISSUES #5) → 기준 UNKNOWN으로 보존, 요금엔진은 계산 불가 처리
      if (dayAmt != null && dayAmt > 0) out.push({ ruleType: "DAILY_MAX", amount: dayAmt, durationMinutes: dayHours != null && dayHours > 0 ? Math.round(dayHours * 60) : null, dayType: "EVERYDAY", dailyMaxBasis: "UNKNOWN" });
    }
  } else if (kind === "혼합") flags.push("FEE_MIXED"); // 무료·유료 구간 구분이 구조화되어 있지 않음 → 계산하지 않음(사용자 결정 2026-11-08)
  else flags.push(kind === "" ? "FEE_KIND_MISSING" : "FEE_KIND_UNSUPPORTED");
  if (monthly != null && monthly > 0 && out.length > 0) out.push({ ruleType: "SEASON_PASS", amount: monthly, durationMinutes: null, dayType: "EVERYDAY", dailyMaxBasis: null });
  return out;
}

function mapSchedules(row: RawRow, flags: string[]): NormalizedSchedule[] {
  const days = s(row["운영요일"]);
  if (days === "") { flags.push("SCHEDULE_MISSING"); return []; }
  const map: Array<[string, NormalizedSchedule["dayType"], string, string]> = [
    ["평일", "WEEKDAY", "평일운영시작시각", "평일운영종료시각"],
    ["토요일", "SATURDAY", "토요일운영시작시각", "토요일운영종료시각"],
    ["공휴일", "HOLIDAY", "공휴일운영시작시각", "공휴일운영종료시각"],
  ];
  const out: NormalizedSchedule[] = [];
  for (const [token, dayType, sk, ek] of map) {
    if (!days.includes(token)) continue;
    const o = hm(s(row[sk])), c = hm(s(row[ek]));
    if (!o || !c || o === c) { flags.push("SCHEDULE_INVALID_TIME"); continue; }
    const allDay = o === "00:00" && (c === "23:59" || c === "24:00");
    out.push({ dayType, openTime: o, closeTime: c, allDay });
  }
  // 일요일: 원천에 별도 항목이 없다. 법령상 일요일은 공휴일(관공서의 공휴일에 관한 규정 제2조)이고 '평일+토요일+공휴일'은 7일 운영 표기와
  // 부합하므로, 사용자 결정(2026-11-08)에 따라 표준데이터에 한해 공휴일 일정을 일요일에도 적용하되 추정으로 표시한다. 실데이터 확인 후 재검토.
  const hol = out.find((x) => x.dayType === "HOLIDAY");
  if (hol && !days.includes("일요일")) {
    out.push({ ...hol, dayType: "SUNDAY", assumed: true });
    flags.push("SUNDAY_ASSUMED_HOLIDAY_RULE");
  }
  return out;
}
