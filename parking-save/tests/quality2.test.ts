// 데이터 품질 보강: 기본 0분·0원 + 단위요금 시설, 정규화 규칙 변경 재반영, 운영시간 이상치
import { describe, expect, it } from "vitest";
import { normalizeStandardRow } from "@/collector/standard-parking";
import { calculateFee, type FeeRule } from "@/domain/fee";
import { hoursAnomaly } from "@/domain/hours-check";
import { createSqliteDb, migrate } from "@/server/db";
import { runSync } from "@/collector/runner";
import type { RawRow, SourceAdapter } from "@/collector/types";

const base: RawRow = { 주차장관리번호: "T-1", 주차장명: "단위요금 노상", 주차장구분: "공영", 주차장유형: "노상", 소재지도로명주소: "서울특별시 노원구 테스트로 1", 위도: "37.65", 경도: "127.06",
  운영요일: "평일+토요일+공휴일", 평일운영시작시각: "09:00", 평일운영종료시각: "18:00", 토요일운영시작시각: "09:00", 토요일운영종료시각: "18:00", 공휴일운영시작시각: "09:00", 공휴일운영종료시각: "18:00",
  요금정보: "유료", 주차기본시간: "0", 주차기본요금: "0", 추가단위시간: "5", 추가단위요금: "250", "1일주차권요금": "0", 데이터기준일자: "2026-10-01" };
const lotOf = (o: RawRow) => { const r = normalizeStandardRow({ ...base, ...o }); if (r.kind !== "ok") throw new Error(r.kind); return r.lot; };
const fee = (rules: FeeRule[], minutes: number) => calculateFee({ startAt: new Date("2026-11-16T10:00:00+09:00"), endAt: new Date(Date.parse("2026-11-16T10:00:00+09:00") + minutes * 60_000), rules, holidays: new Set() });

describe("기본 0분·0원 + 추가 단위요금", () => {
  it("처음부터 단위요금으로 계산: ceil(분/단위) × 단위요금", () => {
    const l = lotOf({});
    expect(l.qualityFlags).toContain("FEE_PER_UNIT_FROM_START");
    expect(l.qualityFlags).not.toContain("FEE_INCOMPLETE");
    const rules = l.feeRules as unknown as FeeRule[];
    for (const [min, won] of [[1, 250], [5, 250], [6, 500], [60, 3000], [61, 3250]]) expect(fee(rules, min)).toMatchObject({ status: "OK", amount: won });
  });
  it("기본요금이 0이 아닌데 기본시간만 0이면 해석이 갈려 계산하지 않음(기존대로)", () => {
    const l = lotOf({ 주차기본요금: "500", 추가단위시간: "30", 추가단위요금: "500" });
    expect(l.feeRules).toEqual([]); expect(l.qualityFlags).toContain("FEE_INCOMPLETE");
  });
  it("추가 단위요금도 0이거나 없으면 그대로 계산 불가(무료로 보지 않음)", () => {
    expect(lotOf({ 추가단위요금: "0" }).feeRules).toEqual([]);
    expect(lotOf({ 추가단위시간: "", 추가단위요금: "" }).feeRules).toEqual([]);
  });
  it("혼합 요금은 여전히 계산하지 않음(사용자 결정)", () => {
    const l = lotOf({ 요금정보: "혼합" });
    expect(l.feeRules).toEqual([]); expect(l.qualityFlags).toContain("FEE_MIXED");
  });
});

describe("정규화 규칙 변경 재반영", () => {
  it("원문이 같아도 품질 플래그가 달라지면 요금 규칙을 다시 저장", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const adapter: SourceAdapter = { sourceName: "STD", async *fetch() { yield base; } };
    await runSync(db, adapter, new Date("2026-11-10T00:00:00Z"));
    const id = (await db.get<{ id: number }>("SELECT id FROM parking_lots"))!.id;
    // 예전 정규화 결과(규칙 없음 + FEE_INCOMPLETE)였던 상태를 재현
    await db.run("DELETE FROM fee_rules WHERE parking_lot_id=?", [id]);
    await db.run("UPDATE parking_lots SET quality_flags=? WHERE id=?", [JSON.stringify(["FEE_INCOMPLETE"]), id]);
    const r = await runSync(db, adapter, new Date("2026-11-11T00:00:00Z"));
    expect(r.unchanged).toBe(0);
    expect((await db.all("SELECT * FROM fee_rules WHERE parking_lot_id=?", [id])).length).toBe(2);
    // 그다음 수집은 변경 없음
    expect((await runSync(db, adapter, new Date("2026-11-12T00:00:00Z"))).unchanged).toBe(1);
  });
});

describe("운영시간 이상치", () => {
  const h = (openTime: string | null, closeTime: string | null, o: Partial<{ allDay: boolean; closed: boolean }> = {}) => hoursAnomaly({ openTime, closeTime, allDay: false, closed: false, ...o });
  it("정상: 주간, 자정 넘김(18:00~05:00), 24시간·휴무", () => {
    expect(h("09:00", "18:00")).toBeNull();
    expect(h("18:00", "05:00")).toBeNull();
    expect(h(null, null, { allDay: true })).toBeNull();
    expect(h("00:00", "00:00", { closed: true })).toBeNull();
  });
  it("이상: 같은 시각, 1시간 미만, 형식 오류", () => {
    expect(h("09:00", "09:00")).toBe("OPEN_EQ_CLOSE");
    expect(h("09:00", "09:30")).toBe("UNDER_1H");
    expect(h("23:50", "00:10")).toBe("UNDER_1H");
    expect(h("9시", "18:00")).toBe("TIME_FORMAT");
    expect(h("09:00", null)).toBe("TIME_FORMAT");
  });
});
