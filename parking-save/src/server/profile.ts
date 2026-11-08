// 수집된 원천의 값 분포 점검 (첫 실호출 검증용, 읽기 전용). 원문(source_raw_records)의 범주형 필드 분포와 결측·좌표 범위를 요약한다.
import type { Db } from "./db";

const CATEGORICAL = ["주차장구분", "주차장유형", "요금정보", "운영요일", "부제시행구분", "급지구분"] as const;
const NUMERIC = ["주차구획수", "주차기본시간", "주차기본요금", "추가단위시간", "추가단위요금", "1일주차권요금", "월정기권요금"] as const;

export interface SourceProfile {
  source: string; rawRecords: number;
  categorical: Record<string, Array<{ value: string; count: number }>>;
  blankRate: Record<string, number>;           // 필드별 미기재 비율(0~1)
  numeric: Record<string, { min: number | null; max: number | null; nonNumeric: number }>;
  coordinates: { missing: number; outOfKorea: number; total: number };
  timeFormats: Record<string, number>;          // 운영시각 표기 형식 분포(예: HH:MM, HHMM, 기타)
}

export async function profileStandardSource(db: Db, source: string, topN = 15): Promise<SourceProfile> {
  const rows = await db.all<{ payload_json: string }>(
    `SELECT r.payload_json FROM source_raw_records r
     JOIN parking_lots l ON l.raw_record_id = r.id WHERE r.source_name = ?`, [source]); // 현재 반영된 원문만
  const p: SourceProfile = { source, rawRecords: rows.length, categorical: {}, blankRate: {}, numeric: {}, coordinates: { missing: 0, outOfKorea: 0, total: rows.length }, timeFormats: {} };
  const parsed = rows.map((r) => JSON.parse(r.payload_json) as Record<string, string>);
  const blank = (v: unknown) => v == null || String(v).trim() === "";
  for (const f of CATEGORICAL) {
    const m = new Map<string, number>();
    for (const r of parsed) { const v = blank(r[f]) ? "(미기재)" : String(r[f]).trim(); m.set(v, (m.get(v) ?? 0) + 1); }
    p.categorical[f] = [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, topN);
  }
  const fields = [...CATEGORICAL, ...NUMERIC, "위도", "경도", "소재지지번주소", "소재지도로명주소", "데이터기준일자", "평일운영시작시각"];
  for (const f of fields) p.blankRate[f] = parsed.length ? parsed.filter((r) => blank(r[f])).length / parsed.length : 0;
  for (const f of NUMERIC) {
    const nums: number[] = []; let bad = 0;
    for (const r of parsed) { if (blank(r[f])) continue; const n = Number(String(r[f]).replace(/,/g, "")); Number.isFinite(n) ? nums.push(n) : bad++; }
    p.numeric[f] = { min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null, nonNumeric: bad };
  }
  for (const r of parsed) {
    const lat = Number(r["위도"]), lng = Number(r["경도"]);
    if (blank(r["위도"]) || blank(r["경도"]) || !Number.isFinite(lat) || !Number.isFinite(lng)) p.coordinates.missing++;
    else if (lat < 33 || lat > 39 || lng < 124 || lng > 132) p.coordinates.outOfKorea++;
    for (const f of ["평일운영시작시각", "토요일운영시작시각", "공휴일운영시작시각"]) {
      const v = String(r[f] ?? "").trim(); if (!v) continue;
      const k = /^\d{1,2}:\d{2}$/.test(v) ? "HH:MM" : /^\d{4}$/.test(v) ? "HHMM" : "기타";
      p.timeFormats[k] = (p.timeFormats[k] ?? 0) + 1;
    }
  }
  return p;
}
