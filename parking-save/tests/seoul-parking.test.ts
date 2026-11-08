// 픽스처는 공개 샘플키로 받은 실제 응답(2026-11-08)의 5행. 그 외 케이스는 같은 행을 변형한 합성 데이터.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SeoulApiError, parseSeoulResponse, seoulOccupancy, type SeoulRow } from "@/collector/seoul-parking";
import { evaluateOccupancy, DEFAULT_OCCUPANCY_CONFIG } from "@/domain/occupancy";

const raw = fs.readFileSync(path.resolve(import.meta.dirname, "fixtures/seoul-getparkinginfo.sample.json"), "utf8");
const { rows, totalCount } = parseSeoulResponse(raw);
const first = rows[0];
const with_ = (o: SeoulRow): SeoulRow => ({ ...first, ...o });

describe("서울 시영주차장 응답 파싱", () => {
  it("실제 샘플: 5행, 전체 122건", () => {
    expect(rows).toHaveLength(5);
    expect(totalCount).toBe(122);
    expect(rows[0].PKLT_NM).toBe("세종로 공영주차장(시)");
  });
  it("오류 코드는 예외(코드만), 데이터 없음은 빈 배열", () => {
    expect(() => parseSeoulResponse(JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다 secret" } }))).toThrow(SeoulApiError);
    try { parseSeoulResponse(JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "x" } })); } catch (e) { expect((e as SeoulApiError).code).toBe("INFO-100"); expect((e as Error).message).not.toContain("secret"); }
    expect(parseSeoulResponse(JSON.stringify({ GetParkingInfo: { list_total_count: 0, RESULT: { CODE: "INFO-200", MESSAGE: "x" } } })).rows).toEqual([]);
    expect(() => parseSeoulResponse("<html>")).toThrow(SeoulApiError);
  });
});

describe("점유 → 잔여면수", () => {
  it("잔여 = 총면수 − 현재 주차 차량수, 갱신시각은 KST로 해석", () => {
    expect(seoulOccupancy(first)).toEqual({ status: "OK", sourceRecordId: "171721", totalSpaces: 1260, occupiedSpaces: 226, availableSpaces: 1034, observedAt: "2026-11-08T01:32:43.000Z" });
    expect(rows.map((r) => (seoulOccupancy(r) as { availableSpaces: number }).availableSpaces)).toEqual([1034, 931, 620, 129, 455]);
  });
  it("기존 신선도 평가와 연결: 3분 전이면 사용, 오래되면 확인 불가", () => {
    const o = seoulOccupancy(first) as Extract<ReturnType<typeof seoulOccupancy>, { status: "OK" }>;
    const input = { totalSpaces: o.totalSpaces, availableSpaces: o.availableSpaces, observedAt: o.observedAt };
    expect(evaluateOccupancy(input, new Date("2026-11-08T10:35:43+09:00"))).toMatchObject({ status: "AVAILABLE", congestion: "RELAXED" });
    expect(evaluateOccupancy(input, new Date("2026-11-08T10:50:00+09:00"))).toEqual({ status: "UNAVAILABLE", reason: "STALE" }); // 10분 기준
    // 제공처는 '20분 이내'를 현재 데이터로 표시 → 신선도 기준을 원천별로 늘릴지는 미결(OPEN_ISSUES #7)
    expect(evaluateOccupancy(input, new Date("2026-11-08T10:50:00+09:00"), { ...DEFAULT_OCCUPANCY_CONFIG, maxAgeMinutes: 20 }).status).toBe("AVAILABLE");
  });
  it("제공처 상태 코드가 '1'이 아니면 현재 주차대수를 쓰지 않음", () => {
    expect(seoulOccupancy(with_({ PRK_STTS_YN: "0" }))).toMatchObject({ status: "UNAVAILABLE", reason: "PROVIDER_STATUS" });
    expect(seoulOccupancy(with_({ PRK_STTS_YN: "Y" }))).toMatchObject({ status: "UNAVAILABLE", reason: "PROVIDER_STATUS" }); // 문서의 Y/N 서술에 속지 않음
    expect(seoulOccupancy(with_({ PRK_STTS_YN: undefined }))).toMatchObject({ reason: "PROVIDER_STATUS" });
  });
  it("값 이상은 추정하지 않음", () => {
    expect(seoulOccupancy(with_({ TPKCT: 0 }))).toMatchObject({ reason: "INVALID_TOTAL" });
    expect(seoulOccupancy(with_({ TPKCT: "abc" }))).toMatchObject({ reason: "INVALID_TOTAL" });
    expect(seoulOccupancy(with_({ NOW_PRK_VHCL_CNT: -1 }))).toMatchObject({ reason: "INVALID_COUNT" });
    expect(seoulOccupancy(with_({ NOW_PRK_VHCL_CNT: null }))).toMatchObject({ reason: "INVALID_COUNT" }); // 값 없음을 0대로 보지 않음
    expect(seoulOccupancy(with_({ NOW_PRK_VHCL_CNT: 1261 }))).toMatchObject({ reason: "OVER_CAPACITY" });
    expect(seoulOccupancy(with_({ NOW_PRK_VHCL_UPDT_TM: "2026/11/08" }))).toMatchObject({ reason: "BAD_TIME" });
    expect(seoulOccupancy(with_({ PKLT_CD: "" }))).toMatchObject({ reason: "NO_ID" });
  });
  it("만차(점유=총면수)는 유효한 0대", () => {
    expect(seoulOccupancy(with_({ NOW_PRK_VHCL_CNT: 1260 }))).toMatchObject({ status: "OK", availableSpaces: 0 });
  });
  it("샘플 행에는 좌표가 없음 → 이 원천만으로는 좌표 검색 불가", () => {
    expect(Object.keys(first).some((k) => /LAT|LNG|LON|XCRD|YCRD/i.test(k))).toBe(false);
  });
});
