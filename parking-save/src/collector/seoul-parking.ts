// 서울시 시영주차장 실시간 주차대수(서울 열린데이터광장 OA-21709, 서비스 GetParkingInfo) 파서.
// 근거: 데이터셋 페이지(2026-11-08)와 공개 샘플키 응답 5행. 전체 코드값 집합·전체 행(122건) 특성은 미확인.
// 주의(실제 샘플에서 확인된 함정):
//  - NOW_PRK_VHCL_CNT는 '현재 주차 차량수'(점유). 잔여면수 = TPKCT − NOW_PRK_VHCL_CNT.
//  - PRK_STTS_YN은 Y/N이 아니라 코드("1" = "현재~20분이내 연계데이터 존재"). 그 외 코드는 현재 주차대수 사용 금지.
//  - 갱신시각 NOW_PRK_VHCL_UPDT_TM은 시간대 표기가 없는 'YYYY-MM-DD HH:mm:ss'. 서울시 데이터이므로 KST로 가정(미확인).
//  - 응답에 위·경도가 없다 → 이 데이터만으로는 좌표 검색 불가(다른 원천과의 연결 필요).
//  - DAY_MAX_CRG=0.0, SAT/LHLDY_CHGD_FREE_SE="N"(이름 "무료")는 의미 불명 → 요금 규칙으로 변환하지 않는다.
import { SEOUL_OCCUPANCY_SOURCE } from "@/domain/occupancy";
export const SEOUL_SOURCE = SEOUL_OCCUPANCY_SOURCE;
export type SeoulRow = Record<string, string | number | null | undefined>;
export class SeoulApiError extends Error { constructor(readonly code: string, msg: string) { super(msg); } }

/** JSON 응답 → 행. INFO-000 정상, INFO-200 데이터 없음(빈 배열), 그 외는 오류(코드만 노출) */
export function parseSeoulResponse(body: string): { rows: SeoulRow[]; totalCount: number } {
  let j: any;
  try { j = JSON.parse(body); } catch { throw new SeoulApiError("BAD_RESPONSE", "응답 파싱 실패"); }
  const result = j?.GetParkingInfo?.RESULT ?? j?.RESULT; // 오류 응답은 최상위 RESULT일 수 있음
  const code = String(result?.CODE ?? "");
  if (code === "INFO-200") return { rows: [], totalCount: 0 };
  if (code !== "INFO-000") throw new SeoulApiError(code || "BAD_RESPONSE", "원천 오류 응답");
  const rows = j.GetParkingInfo.row;
  return { rows: Array.isArray(rows) ? rows : [], totalCount: Number(j.GetParkingInfo.list_total_count ?? 0) };
}

export type SeoulOccupancy =
  | { status: "OK"; sourceRecordId: string; totalSpaces: number; occupiedSpaces: number; availableSpaces: number; observedAt: string }
  | { status: "UNAVAILABLE"; sourceRecordId: string | null; reason: "NO_ID" | "PROVIDER_STATUS" | "INVALID_TOTAL" | "INVALID_COUNT" | "OVER_CAPACITY" | "BAD_TIME" };

const wholeNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};

/** 한 행 → 점유 스냅샷. 의미가 불명확하거나 값이 이상하면 UNAVAILABLE(추정하지 않음) */
export function seoulOccupancy(row: SeoulRow): SeoulOccupancy {
  const id = String(row.PKLT_CD ?? "").trim();
  if (!id) return { status: "UNAVAILABLE", sourceRecordId: null, reason: "NO_ID" };
  const un = (reason: Extract<SeoulOccupancy, { status: "UNAVAILABLE" }>["reason"]): SeoulOccupancy => ({ status: "UNAVAILABLE", sourceRecordId: id, reason });
  if (String(row.PRK_STTS_YN ?? "").trim() !== "1") return un("PROVIDER_STATUS");
  const total = wholeNumber(row.TPKCT);
  if (total == null || total <= 0) return un("INVALID_TOTAL");
  const now = wholeNumber(row.NOW_PRK_VHCL_CNT);
  if (now == null || now < 0) return un("INVALID_COUNT");
  if (now > total) return un("OVER_CAPACITY"); // 점유 > 총면수: 값의 의미를 신뢰할 수 없음
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(row.NOW_PRK_VHCL_UPDT_TM ?? "").trim());
  const t = m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`) : NaN; // KST 가정
  if (Number.isNaN(t)) return un("BAD_TIME");
  return { status: "OK", sourceRecordId: id, totalSpaces: total, occupiedSpaces: now, availableSpaces: total - now, observedAt: new Date(t).toISOString() };
}
