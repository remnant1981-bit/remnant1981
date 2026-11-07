// 주의: 아래 응답은 공식 응답 표(locdate/isHoliday/dateName/dateKind/seq/resultCode)를 따른 '합성' 데이터이며 실제 공휴일 목록이 아님.
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { HolidayApiError, kasiMonthFetcher, parseHolidayResponse, syncHolidays, type MonthFetcher } from "@/collector/holidays";
import { loadHolidays } from "@/server/search";

const item = (loc: string, name: string, isHoliday = "Y", seq = 1) => ({ dateKind: "01", dateName: name, isHoliday, locdate: Number(loc), seq });
const json = (items: unknown[] | object | "", code = "00") => JSON.stringify({ response: { header: { resultCode: code, resultMsg: "OK" }, body: { items: items === "" ? "" : { item: items }, numOfRows: 100, pageNo: 1, totalCount: Array.isArray(items) ? items.length : items === "" ? 0 : 1 } } });
const NOW = new Date("2026-11-07T12:00:00+09:00");

// 연·월 → 합성 응답. FIXED: 신정/성탄절(canary) + 임의 합성일
function synthetic(opts: { skip?: (y: number, m: number) => boolean; extra?: Record<string, string>; failAt?: (y: number, m: number) => boolean } = {}): MonthFetcher {
  return async (y, m) => {
    if (opts.failAt?.(y, m)) throw new HolidayApiError("NETWORK", "x");
    if (opts.skip?.(y, m)) return json("");
    const items: unknown[] = [];
    if (m === 1) items.push(item(`${y}0101`, "신정(합성)"));
    if (m === 12) items.push(item(`${y}1225`, "성탄절(합성)"));
    if (m === 3) items.push(item(`${y}0301`, "합성A"), item(`${y}0301`, "합성B(겹침)", "Y", 2), item(`${y}0302`, "기념일(휴일 아님)", "N"));
    for (const [k, v] of Object.entries(opts.extra ?? {})) if (k.startsWith(`${y}${String(m).padStart(2, "0")}`)) items.push(item(k, v));
    return json(items);
  };
}

describe("응답 파싱", () => {
  it("JSON: 다건/단건/빈 items, 휴일 여부 N 제외", () => {
    expect(parseHolidayResponse(json([item("20261225", "성탄절"), item("20261226", "기념일", "N")])).entries).toEqual([{ date: "2026-12-25", seq: 1, name: "성탄절", dateKind: "01" }]);
    expect(parseHolidayResponse(json(item("20261225", "성탄절") as object)).entries).toHaveLength(1); // 단건은 배열이 아닌 객체
    expect(parseHolidayResponse(json("")).entries).toEqual([]);
  });
  it("XML(공식 포맷)", () => {
    const xml = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items><item><dateKind>01</dateKind><dateName>성탄절</dateName><isHoliday>Y</isHoliday><locdate>20261225</locdate><seq>1</seq></item></items><totalCount>1</totalCount></body></response>`;
    expect(parseHolidayResponse(xml).entries[0]).toMatchObject({ date: "2026-12-25", name: "성탄절" });
  });
  it("오류 응답은 예외(코드만 노출)", () => {
    expect(() => parseHolidayResponse(json("", "99"))).toThrow(HolidayApiError);
    const gw = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    expect(() => parseHolidayResponse(gw)).toThrow(/게이트웨이/);
    try { parseHolidayResponse(gw); } catch (e) { expect((e as HolidayApiError).code).toBe("30"); }
    expect(() => parseHolidayResponse("<html>")).toThrow();
    expect(() => parseHolidayResponse(json([item("2026-12-25", "x")]))).toThrow(/날짜/); // 형식 불량
  });
});

describe("HTTP 클라이언트", () => {
  it("요청 파라미터 구성, 실패 시 키 미노출", async () => {
    let seen = "";
    const ok = kasiMonthFetcher({ serviceKey: "SECRET-KEY", fetchImpl: (async (u: URL) => { seen = String(u); return new Response(json("")); }) as never });
    await ok(2026, 5);
    expect(seen).toContain("/getRestDeInfo?"); expect(seen).toContain("solYear=2026"); expect(seen).toContain("solMonth=05");
    const bad = kasiMonthFetcher({ serviceKey: "SECRET-KEY", fetchImpl: (async () => { throw new Error("connect https://x/?serviceKey=SECRET-KEY"); }) as never });
    await expect(bad(2026, 5)).rejects.toSatisfy((e: Error) => !e.message.includes("SECRET-KEY") && (e as HolidayApiError).code === "NETWORK");
    const http = kasiMonthFetcher({ serviceKey: "SECRET-KEY", fetchImpl: (async () => new Response("no", { status: 503 })) as never });
    await expect(http(2026, 5)).rejects.toMatchObject({ code: "HTTP_503" });
  });
});

describe("동기화·커버리지", () => {
  let db: Db;
  beforeEach(async () => { db = await createSqliteDb(":memory:"); await migrate(db); });
  const day = (s: string) => new Date(s + "T10:00:00+09:00");

  it("당해+다음 해 성공 → 커버리지 선언, 같은 날 겹침(seq) 보존", async () => {
    const r = await syncHolidays(db, synthetic(), NOW);
    expect(r).toMatchObject({ status: "SUCCESS", coverage: { from: "2026-01-01", to: "2027-12-31" } });
    const h = await loadHolidays(db, day("2026-12-24"), day("2026-12-26"), NOW);
    expect([...h!]).toEqual(["2026-12-25"]);
    const n = await db.get<{ c: number }>("SELECT COUNT(*) c FROM holidays WHERE date='2026-03-01'");
    expect(n?.c).toBe(2);
    expect((await loadHolidays(db, day("2027-03-01"), day("2027-03-01"), NOW))?.has("2027-03-01")).toBe(true);
  });
  it("기념일(isHoliday=N)은 공휴일로 저장하지 않음", async () => {
    await syncHolidays(db, synthetic(), NOW);
    expect((await db.get<{ c: number }>("SELECT COUNT(*) c FROM holidays WHERE date='2026-03-02'"))?.c).toBe(0);
  });
  it("다음 해 미공표(canary 없음) → 당해만 커버리지, 다음 해는 판정 불가(공휴일 없음으로 오인 금지)", async () => {
    const r = await syncHolidays(db, synthetic({ skip: (y) => y === 2027 }), NOW);
    expect(r).toMatchObject({ status: "PARTIAL", coverage: { to: "2026-12-31" } });
    expect(r.years[1]).toMatchObject({ complete: false, reason: "CANARY_MISSING" });
    expect(await loadHolidays(db, day("2027-03-01"), day("2027-03-01"), NOW)).toBeNull();
    expect(await loadHolidays(db, day("2026-12-30"), day("2027-01-02"), NOW)).toBeNull(); // 연도 걸침도 불가
  });
  it("당해 수집 실패 → FAILED, 기존 데이터·커버리지 유지", async () => {
    await syncHolidays(db, synthetic(), NOW);
    const r = await syncHolidays(db, synthetic({ failAt: (y, m) => y === 2026 && m === 7 }), new Date("2026-11-08T12:00:00+09:00"));
    expect(r.status).toBe("FAILED"); expect(r.coverage).toBeNull();
    expect((await db.get<{ c: number }>("SELECT COUNT(*) c FROM holiday_coverage"))?.c).toBe(1);
    expect(await loadHolidays(db, day("2026-12-25"), day("2026-12-25"), new Date("2026-11-08T12:00:00+09:00"))).not.toBeNull();
    const log = await db.get<{ status: string; error_summary: string }>("SELECT * FROM source_sync_logs ORDER BY id DESC LIMIT 1");
    expect(log?.status).toBe("FAILED"); expect(log?.error_summary).toContain("API_NETWORK");
  });
  it("다음 해 중간 실패 → 당해만 선언(연속 구간만)", async () => {
    const r = await syncHolidays(db, synthetic({ failAt: (y, m) => y === 2027 && m === 6 }), NOW);
    expect(r.status).toBe("PARTIAL"); expect(r.coverage?.to).toBe("2026-12-31");
  });
  it("재수집 시 취소된 공휴일이 사라지고 신규 임시공휴일이 반영됨", async () => {
    await syncHolidays(db, synthetic({ extra: { "20261105": "합성 임시" } }), NOW);
    expect((await loadHolidays(db, day("2026-11-05"), day("2026-11-05"), NOW))?.has("2026-11-05")).toBe(true);
    await syncHolidays(db, synthetic(), new Date("2026-11-08T12:00:00+09:00"));
    expect((await loadHolidays(db, day("2026-11-05"), day("2026-11-05"), new Date("2026-11-08T12:00:00+09:00")))?.has("2026-11-05")).toBe(false);
  });
  it("마지막 성공 수집이 7일 넘으면 커버리지 만료 → 판정 불가", async () => {
    await syncHolidays(db, synthetic(), NOW);
    expect(await loadHolidays(db, day("2026-12-25"), day("2026-12-25"), new Date("2026-11-13T12:00:00+09:00"))).not.toBeNull();
    expect(await loadHolidays(db, day("2026-12-25"), day("2026-12-25"), new Date("2026-11-15T12:00:00+09:00"))).toBeNull();
  });
});
