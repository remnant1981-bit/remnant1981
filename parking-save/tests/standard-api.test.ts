// API 응답 형태는 공식 출력결과 표(키 이름)에 따른 '합성' 데이터. 값은 픽스처(포털 공개 샘플 행 + 합성 경계 행)를 API 키로 되돌려 만든다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createSqliteDb, migrate } from "@/server/db";
import { runSync } from "@/collector/runner";
import { normalizeStandardRow } from "@/collector/standard-parking";
import { STANDARD_KEY_MAP, StandardApiAdapter, StandardApiError, mapStandardItem, parseStandardResponse, standardPageFetcher } from "@/collector/standard-api";
import { POST as adminSync } from "@/app/api/admin/sync/route";
import type { RawRow } from "@/collector/types";

const FIX = path.resolve(import.meta.dirname, "fixtures/standard-parking.sample.json");
const fileRows = (JSON.parse(fs.readFileSync(FIX, "utf8")) as { rows: RawRow[] }).rows;
const INVERSE = Object.fromEntries(Object.entries(STANDARD_KEY_MAP).map(([k, ko]) => [ko, k]));
const toApiItem = (r: RawRow) => Object.fromEntries(Object.entries(r).map(([ko, v]) => [INVERSE[ko], v]));
const envelope = (items: unknown, total: number, code = "00") => JSON.stringify({ response: { header: { resultCode: code, resultMsg: "NORMAL SERVICE." }, body: { items, totalCount: total, numOfRows: 100, pageNo: 1 } } });

describe("키 매핑", () => {
  it("공식 출력결과 표의 키 32개가 모두 한글 컬럼으로 매핑됨(제공기관코드 instt_code 제외)", () => {
    expect(Object.keys(STANDARD_KEY_MAP)).toHaveLength(32);
    expect(new Set(Object.values(STANDARD_KEY_MAP)).size).toBe(32);
    expect(STANDARD_KEY_MAP.holidayCloseOpenHhmm).toBe("공휴일운영종료시각"); // 공식 표기의 오탈자 그대로
    expect(STANDARD_KEY_MAP.satOperOperOpenHhmm).toBe("토요일운영시작시각");
  });
  it("왕복: 한글 행 → API 키 → 다시 매핑해도 정규화 결과가 동일", () => {
    for (const row of fileRows) {
      const back = mapStandardItem(toApiItem(row));
      expect(normalizeStandardRow(back)).toEqual(normalizeStandardRow(row));
    }
  });
  it("누락·null 값은 빈 문자열(미기재)로, 알 수 없는 키는 무시", () => {
    const r = mapStandardItem({ prkplceNo: "X", prkplceNm: "Y", latitude: null, unknownKey: "z" });
    expect(r["위도"]).toBe(""); expect(r["주차장관리번호"]).toBe("X"); expect(Object.keys(r)).not.toContain("unknownKey");
  });
});

describe("응답 파싱", () => {
  const item = toApiItem(fileRows[0]);
  it("items 배열 / items.item 배열 / 단건 객체 / 빈 값", () => {
    expect(parseStandardResponse(envelope([item], 1)).items).toHaveLength(1);
    expect(parseStandardResponse(envelope({ item: [item, item] }, 2)).items).toHaveLength(2);
    expect(parseStandardResponse(envelope({ item }, 1)).items).toHaveLength(1);
    expect(parseStandardResponse(envelope("", 0)).items).toEqual([]);
    expect(parseStandardResponse(envelope(undefined, 0)).items).toEqual([]);
  });
  it("XML 응답", () => {
    const xml = `<response><header><resultCode>00</resultCode></header><body><items><item><prkplceNo>A-1</prkplceNo><prkplceNm><![CDATA[테스트 주차장]]></prkplceNm><latitude>35.8</latitude></item></items><totalCount>1</totalCount></body></response>`;
    const r = parseStandardResponse(xml);
    expect(r.items[0]).toMatchObject({ prkplceNo: "A-1", prkplceNm: "테스트 주차장" });
  });
  it("오류 응답은 코드만 노출", () => {
    expect(() => parseStandardResponse(envelope([], 0, "30"))).toThrow(StandardApiError);
    try { parseStandardResponse(envelope([], 0, "22")); } catch (e) { expect((e as StandardApiError).code).toBe("22"); }
    try { parseStandardResponse(JSON.stringify({ cmmMsgHeader: { errMsg: "SERVICE ERROR", returnReasonCode: "30" } })); } catch (e) { expect((e as StandardApiError).code).toBe("30"); }
    expect(() => parseStandardResponse("<html>")).toThrow();
    expect(() => parseStandardResponse("{}")).toThrow(/형식/);
  });
});

describe("페이지 수집 어댑터", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...toApiItem(fileRows[0]), prkplceNo: `P-${i}` }));
  const collect = async (a: StandardApiAdapter) => { const out: RawRow[] = []; for await (const r of a.fetch()) out.push(r); return out; };

  it("totalCount 도달 시 종료(250건 = 100+100+50), 정규화기용 한글 행으로 공급", async () => {
    const all = mk(250); const calls: number[] = [];
    const a = new StandardApiAdapter(async (p, n) => { calls.push(p); return envelope(all.slice((p - 1) * n, p * n), 250); }, 100);
    const rows = await collect(a);
    expect(rows).toHaveLength(250); expect(calls).toEqual([1, 2, 3]);
    expect(rows[0]["주차장관리번호"]).toBe("P-0");
  });
  it("정확히 페이지 크기의 배수일 때 불필요한 추가 호출 없음", async () => {
    const all = mk(200); const calls: number[] = [];
    await collect(new StandardApiAdapter(async (p, n) => { calls.push(p); return envelope(all.slice((p - 1) * n, p * n), 200); }, 100));
    expect(calls).toEqual([1, 2]);
  });
  it("중간 페이지 실패 → 예외(runSync가 FAILED 기록), 이전 페이지 행은 저장 유지", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const all = mk(150);
    const a = new StandardApiAdapter(async (p, n) => { if (p === 2) throw new StandardApiError("NETWORK", "x"); return envelope(all.slice((p - 1) * n, p * n), 150); }, 100);
    const r = await runSync(db, a);
    expect(r.status).toBe("FAILED"); expect(r.inserted).toBe(100);
    const log = await db.get<{ status: string; error_summary: string }>("SELECT * FROM source_sync_logs");
    expect(log).toMatchObject({ status: "FAILED" }); expect(log!.error_summary).not.toMatch(/https?:|serviceKey/i);
  });
  it("페이지 상한 초과(무한 루프 방지)", async () => {
    const a = new StandardApiAdapter(async () => envelope(mk(100), 1_000_000), 100, 3);
    await expect(collect(a)).rejects.toMatchObject({ code: "PAGE_LIMIT" });
  });
});

describe("종단 간(합성 응답 → 저장)", () => {
  it("공영·노외 필터, 민영 제외, 일요일 추정, 원문 보존, 출처명", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const items = fileRows.filter((r) => r["주차장관리번호"]).map(toApiItem);
    const r = await runSync(db, new StandardApiAdapter(async (p, n) => envelope(items.slice((p - 1) * n, p * n), items.length), 100));
    expect(r).toMatchObject({ inserted: 9, excluded: 2 });
    const lot = await db.get<{ source_name: string; ownership_type: string; parking_type: string; latitude: number }>("SELECT * FROM parking_lots WHERE source_record_id='156-2-000050'");
    expect(lot).toMatchObject({ source_name: "DATA_GO_KR_15012896", ownership_type: "PUBLIC", parking_type: "OFF_STREET", latitude: 35.83224429 });
    expect((await db.get<{ c: number }>("SELECT COUNT(*) c FROM operating_schedules WHERE holiday_policy='SUNDAY_ASSUMED'"))!.c).toBeGreaterThan(0);
    expect((await db.get<{ c: number }>("SELECT COUNT(*) c FROM source_raw_records"))!.c).toBe(9);
  });
});

describe("HTTP 클라이언트", () => {
  it("요청 파라미터, 실패 시 키·URL 미노출", async () => {
    let seen = "";
    await standardPageFetcher({ serviceKey: "SECRET-DK", fetchImpl: (async (u: URL) => { seen = String(u); return new Response(envelope([], 0)); }) as never })(3, 50);
    expect(seen).toContain("api.data.go.kr/openapi/tn_pubr_prkplce_info_api?"); expect(seen).toContain("pageNo=3"); expect(seen).toContain("numOfRows=50");
    const bad = standardPageFetcher({ serviceKey: "SECRET-DK", fetchImpl: (async () => { throw new Error("fail https://x/?serviceKey=SECRET-DK"); }) as never });
    await expect(bad(1, 10)).rejects.toSatisfy((e: Error) => !e.message.includes("SECRET") && (e as StandardApiError).code === "NETWORK");
    await expect(standardPageFetcher({ serviceKey: "k", fetchImpl: (async () => new Response("x", { status: 502 })) as never })(1, 10)).rejects.toMatchObject({ code: "HTTP_502" });
  });
});

describe("관리자 job standard-parking", () => {
  const TOKEN = "s".repeat(40);
  const post = (ip: string) => adminSync(new NextRequest("http://localhost/api/admin/sync", { method: "POST", body: JSON.stringify({ job: "standard-parking" }), headers: { "x-forwarded-for": ip, authorization: `Bearer ${TOKEN}` } }));
  beforeEach(() => { process.env.ADMIN_API_TOKEN = TOKEN; delete process.env.DATA_GO_KR_SERVICE_KEY; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.ADMIN_API_TOKEN; delete process.env.DATA_GO_KR_SERVICE_KEY; });

  it("키 없으면 400, 있으면 수집 + 응답에 키 없음, 원천 오류는 502", async () => {
    expect((await post("10.1.0.1")).status).toBe(400);
    process.env.DATA_GO_KR_SERVICE_KEY = "SECRET-DK";
    const items = fileRows.filter((r) => r["주차장관리번호"]).map(toApiItem);
    vi.stubGlobal("fetch", async () => new Response(envelope(items, items.length)));
    const ok = await post("10.1.0.2"); const j = await ok.json();
    expect(ok.status).toBe(200); expect(j).toMatchObject({ job: "standard-parking", inserted: 9 });
    expect(JSON.stringify(j)).not.toContain("SECRET-DK");
    vi.stubGlobal("fetch", async () => new Response("err", { status: 500 }));
    expect((await post("10.1.0.3")).status).toBe(502);
  });
});
