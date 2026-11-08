// 서울 응답 픽스처는 공개 샘플키로 받은 실제 5행. 표준데이터 시설은 주소 매칭 검증용 합성 데이터.
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { runSync } from "@/collector/runner";
import { linkScore, seoulAddressKey, seoulPageFetcher, syncSeoulOccupancy, type PageFetcher } from "@/collector/seoul-sync";
import { SeoulApiError } from "@/collector/seoul-parking";
import { decide, listPending } from "@/server/duplicates";
import { parseSearchParams, searchLots } from "@/server/search";
import { buildQualityReport } from "@/server/quality";
import type { RawRow, SourceAdapter } from "@/collector/types";

const BODY = fs.readFileSync(path.resolve(import.meta.dirname, "fixtures/seoul-getparkinginfo.sample.json"), "utf8");
const fixedPage: PageFetcher = async () => BODY;
const T_SYNC = new Date("2026-11-08T10:33:30+09:00");   // 관측 10:32:43 직후 수집
const at = (hhmmss: string) => new Date(`2026-11-08T${hhmmss}+09:00`);

const stdRow = (o: RawRow): RawRow => ({ 주차장구분: "공영", 주차장유형: "노외", 운영요일: "평일+토요일+공휴일", 평일운영시작시각: "00:00", 평일운영종료시각: "23:59", 토요일운영시작시각: "00:00", 토요일운영종료시각: "23:59", 공휴일운영시작시각: "00:00", 공휴일운영종료시각: "23:59", 요금정보: "유료", 주차기본시간: "5", 주차기본요금: "430", 추가단위시간: "5", 추가단위요금: "430", 데이터기준일자: "2026-10-06", ...o });
const std = (rows: RawRow[]): SourceAdapter => ({ sourceName: "STD", async *fetch() { for (const r of rows) yield r; } });

describe("주소 키·연결 점수", () => {
  it("서울 주소(시·도 생략, 부번 0)와 표준데이터 지번주소를 같은 키로", () => {
    expect(seoulAddressKey("종로구 세종로 80-1")).toBe("종로구|세종로|80-1");
    expect(seoulAddressKey("서울특별시 종로구 세종로 80-1")).toBe("종로구|세종로|80-1");
    expect(seoulAddressKey("종로구 훈정동 2-0")).toBe("종로구|훈정동|2");
    expect(seoulAddressKey("서울특별시 종로구 훈정동 2번지")).toBe("종로구|훈정동|2");
    expect(seoulAddressKey("중구 을지로5가 40-3")).toBe("중구|을지로5가|40-3");
    expect(seoulAddressKey("용산구 한강로2가 12-9")).toBe("용산구|한강로2가|12-9");
    expect(seoulAddressKey("종로구 세종로 80-2")).not.toBe(seoulAddressKey("종로구 세종로 80-1"));
    expect(seoulAddressKey("세종로")).toBeNull();
    expect(seoulAddressKey(null)).toBeNull();
  });
  it("주소 불일치는 후보 아님, 일치 시 이름·면수로 가점", () => {
    const a = { name: "세종로 공영주차장(시)", addressKey: "종로구|세종로|80-1", totalSpaces: 1260 };
    expect(linkScore(a, { name: "세종로 공영주차장", addressKey: "종로구|세종로|80-2", totalSpaces: 1260 })).toBeNull();
    expect(linkScore(a, { name: "세종로 공영주차장", addressKey: "종로구|세종로|80-1", totalSpaces: 1260 })!.score).toBe(1);
    expect(linkScore(a, { name: "전혀 다른 이름", addressKey: "종로구|세종로|80-1", totalSpaces: null })!.score).toBe(0.7);
  });
});

describe("서울 수집 → 연결 후보 → 승인 → 검색 반영", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createSqliteDb(":memory:"); await migrate(db);
    await runSync(db, std([
      stdRow({ 주차장관리번호: "S-1", 주차장명: "세종로 공영주차장", 소재지지번주소: "서울특별시 종로구 세종로 80-1", 주차구획수: "1260", 위도: "37.5725", 경도: "126.9769" }),
      stdRow({ 주차장관리번호: "S-2", 주차장명: "세종로 다른 주차장", 소재지지번주소: "서울특별시 종로구 세종로 80-2", 주차구획수: "50", 위도: "37.5726", 경도: "126.9770" }),
    ]));
  });
  const search = async (now: Date) => {
    const r = parseSearchParams(new URLSearchParams({ lat: "37.5725", lng: "126.9769", radiusMeters: "500", startAt: "2026-11-08T11:00:00+09:00", endAt: "2026-11-08T12:00:00+09:00" }));
    if (!r.ok) throw new Error(r.code);
    return searchLots(db, r.params, now);
  };
  const s1 = (res: Awaited<ReturnType<typeof search>>) => res.items.find((i) => i.name === "세종로 공영주차장")!;

  it("서울 시설은 좌표 없이 저장되고 검색에 노출되지 않으며, 점유 스냅샷이 쌓임", async () => {
    const r = await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    expect(r).toMatchObject({ status: "SUCCESS", received: 5, lots: 5, snapshots: 5, newCandidates: 1 });
    const lot = await db.get<{ latitude: number | null; ownership_type: string; quality_flags: string; total_spaces: number }>("SELECT * FROM parking_lots WHERE source_record_id='171721'");
    expect(lot).toMatchObject({ latitude: null, ownership_type: "PUBLIC", total_spaces: 1260 });
    expect(lot!.quality_flags).toContain("NO_COORDS_BY_DESIGN");
    const res = await search(at("10:35:43"));
    expect(res.items.some((i) => i.name.includes("(시)"))).toBe(false);
  });
  it("승인 전에는 표준데이터 시설에 실시간 값이 붙지 않음 (후보만으로 연결 금지)", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    expect(s1(await search(at("10:35:43"))).occupancy).toEqual({ status: "UNAVAILABLE", reason: "NO_DATA" });
    const pending = await listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ score: 1 });
    expect([pending[0].a.source, pending[0].b.source].sort()).toEqual(["SEOUL_OA21709", "STD"]);
    expect(pending[0].reason).toContain("지번 주소 일치");
  });
  it("승인 후: 잔여 1034면, 관측시각 포함. 서울은 20분까지 유효, 그 이후 확인 불가", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    const [c] = await listPending(db);
    expect(await decide(db, c.id, "MERGED", "홍길동")).toBe(true);
    expect(s1(await search(at("10:35:43"))).occupancy).toMatchObject({ status: "AVAILABLE", availableSpaces: 1034, totalSpaces: 1260, observedAt: "2026-11-08T01:32:43.000Z" });
    expect(s1(await search(at("10:50:00"))).occupancy.status).toBe("AVAILABLE");               // 17분 경과: 서울 기준 20분 이내
    expect(s1(await search(at("10:55:00"))).occupancy).toEqual({ status: "UNAVAILABLE", reason: "STALE" }); // 22분 경과
    // 같은 연결이 없는 다른 시설(S-2)에는 영향 없음
    expect((await search(at("10:35:43"))).items.find((i) => i.name === "세종로 다른 주차장")!.occupancy.status).toBe("UNAVAILABLE");
    const audit = await db.get<{ action: string; outcome: string; client_hash: string }>("SELECT * FROM admin_audit_logs WHERE action='duplicate:approve'");
    expect(audit).toMatchObject({ outcome: "OK" });
    expect(audit!.client_hash).not.toContain("홍길동");
  });
  it("거절하면 연결되지 않고, 이미 결정된 후보는 바꿀 수 없음", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    const [c] = await listPending(db);
    expect(await decide(db, c.id, "REJECTED", "홍길동")).toBe(true);
    expect(await decide(db, c.id, "MERGED", "홍길동")).toBe(false);
    expect(s1(await search(at("10:35:43"))).occupancy.status).toBe("UNAVAILABLE");
    expect(await listPending(db)).toHaveLength(0);
  });
  it("재수집은 멱등: 시설·후보 중복 생성 없음, 거절된 후보는 되살리지 않음", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    const [c] = await listPending(db);
    await decide(db, c.id, "REJECTED", "홍길동");
    const r2 = await syncSeoulOccupancy(db, fixedPage, new Date(T_SYNC.getTime() + 300_000));
    expect(r2.newCandidates).toBe(0);
    expect((await db.get<{ c: number }>("SELECT COUNT(*) c FROM parking_lots WHERE source_name='SEOUL_OA21709'"))!.c).toBe(5);
    expect(await listPending(db)).toHaveLength(0);
  });
  it("결정자 이름 없이는 승인 불가", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    const [c] = await listPending(db);
    await expect(decide(db, c.id, "MERGED", "  ")).rejects.toThrow();
  });
  it("오래된 스냅샷 정리(2일 초과)", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    await syncSeoulOccupancy(db, fixedPage, new Date(T_SYNC.getTime() + 3 * 86400_000));
    expect((await db.get<{ c: number }>("SELECT COUNT(*) c FROM occupancy_snapshots"))!.c).toBe(5);
  });
  it("품질 리포트: 좌표 없음이 설계상 정상인 서울 시설은 좌표 불량률에서 제외", async () => {
    await syncSeoulOccupancy(db, fixedPage, T_SYNC);
    const r = await buildQualityReport(db, at("10:40:00"));
    expect(r.alerts.map((a) => a.code)).not.toContain("COORD_QUALITY");
    expect(r.alerts.map((a) => a.code)).toContain("DUPLICATES_PENDING");
  });
});

describe("서울 수집 실패·보안", () => {
  let db: Db;
  beforeEach(async () => { db = await createSqliteDb(":memory:"); await migrate(db); });

  it("인증 오류 응답 → FAILED, 로그에 키·메시지 미포함", async () => {
    const r = await syncSeoulOccupancy(db, async () => JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다 SECRET-SEOUL-KEY" } }), T_SYNC);
    expect(r.status).toBe("FAILED");
    const log = await db.get<{ status: string; error_summary: string }>("SELECT * FROM source_sync_logs");
    expect(log).toMatchObject({ status: "FAILED" });
    expect(log!.error_summary).toContain("INFO-100");
    expect(log!.error_summary).not.toContain("SECRET");
  });
  it("현재 주차대수 사용 불가 행은 PARTIAL로 기록(해당 행 스냅샷 없음)", async () => {
    const j = JSON.parse(BODY); j.GetParkingInfo.row[0].PRK_STTS_YN = "0";
    const r = await syncSeoulOccupancy(db, async () => JSON.stringify(j), T_SYNC);
    expect(r).toMatchObject({ status: "PARTIAL", snapshots: 4, unavailable: { PROVIDER_STATUS: 1 } });
  });
  it("호출 클라이언트: 키는 URL 경로로만, 실패 메시지에 키·URL 없음", async () => {
    let seen = "";
    await seoulPageFetcher({ key: "K/EY 1", baseUrl: "https://example.test", fetchImpl: (async (u: string) => { seen = u; return new Response(BODY); }) as never })(1, 5);
    expect(seen).toBe("https://example.test/K%2FEY%201/json/GetParkingInfo/1/5/");
    const bad = seoulPageFetcher({ key: "SECRET-SEOUL-KEY", fetchImpl: (async () => { throw new Error("connect http://openapi.seoul.go.kr:8088/SECRET-SEOUL-KEY/json"); }) as never });
    await expect(bad(1, 5)).rejects.toSatisfy((e: Error) => e instanceof SeoulApiError && !e.message.includes("SECRET") && e.code === "NETWORK");
    const http = seoulPageFetcher({ key: "SECRET-SEOUL-KEY", fetchImpl: (async () => new Response("x", { status: 503 })) as never });
    await expect(http(1, 5)).rejects.toMatchObject({ code: "HTTP_503" });
  });
});
