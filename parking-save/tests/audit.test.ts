// 출시 전 점검에서 찾은 결함의 회귀 테스트
import { describe, expect, it } from "vitest";
import { createSqliteDb, migrate } from "@/server/db";
import { operatingForStay, type ScheduleRow } from "@/domain/operating";
import { parseOffsetIso } from "@/lib/time";
import { runSync } from "@/collector/runner";
import { readFileSync } from "node:fs";

const kst = (s: string) => Date.parse(`${s}+09:00`);
const nine18: ScheduleRow[] = [{ dayType: "EVERYDAY", openTime: "09:00", closeTime: "18:00", allDay: false, closed: false }];

describe("운영 판정: 이용 구간 전체 기준", () => {
  it("입·출차가 모두 운영 시간이어도 중간에 폐장하면 운영 외", () => {
    expect(operatingForStay(nine18, kst("2026-11-10T10:00"), kst("2026-11-11T10:00"), new Set())).toBe("OUTSIDE");
  });
  it("종료 시각이 정확히 폐장 시각이면 운영(구간은 종료 시각 미포함)", () => {
    expect(operatingForStay(nine18, kst("2026-11-10T16:00"), kst("2026-11-10T18:00"), new Set())).toBe("OPERATING");
  });
  it("폐장 후 1분이라도 걸치면 운영 외, 개장 전 시작도 운영 외", () => {
    expect(operatingForStay(nine18, kst("2026-11-10T16:00"), kst("2026-11-10T18:01"), new Set())).toBe("OUTSIDE");
    expect(operatingForStay(nine18, kst("2026-11-10T08:30"), kst("2026-11-10T10:00"), new Set())).toBe("OUTSIDE");
  });
  it("자정 통과 운영시간(22–06시)은 연속 이용 가능", () => {
    const night: ScheduleRow[] = [{ dayType: "EVERYDAY", openTime: "22:00", closeTime: "06:00", allDay: false, closed: false }];
    expect(operatingForStay(night, kst("2026-11-10T23:00"), kst("2026-11-11T05:00"), new Set())).toBe("OPERATING");
    expect(operatingForStay(night, kst("2026-11-10T23:00"), kst("2026-11-11T07:00"), new Set())).toBe("OUTSIDE");
  });
  it("24시간 시설·판정 불가 데이터", () => {
    const all: ScheduleRow[] = [{ dayType: "EVERYDAY", openTime: null, closeTime: null, allDay: true, closed: false }];
    expect(operatingForStay(all, kst("2026-11-10T00:00"), kst("2026-11-13T00:00"), new Set())).toBe("OPERATING");
    expect(operatingForStay([], kst("2026-11-10T10:00"), kst("2026-11-10T11:00"), new Set())).toBe("UNKNOWN");
    const wk: ScheduleRow[] = [{ dayType: "WEEKDAY", openTime: "09:00", closeTime: "18:00", allDay: false, closed: false }];
    expect(operatingForStay(wk, kst("2026-11-10T10:00"), kst("2026-11-10T11:00"), null)).toBe("UNKNOWN"); // 공휴일 데이터 없음
  });
  it("요일이 바뀌며 규칙이 달라지는 경우(평일 운영, 토요일 휴무)", () => {
    const rows: ScheduleRow[] = [
      { dayType: "WEEKDAY", openTime: "09:00", closeTime: "18:00", allDay: false, closed: false },
      { dayType: "SATURDAY", openTime: null, closeTime: null, allDay: false, closed: true },
    ];
    // 금요일 17:00 ~ 토요일 10:00: 토요일은 휴무
    expect(operatingForStay(rows, kst("2026-11-13T17:00"), kst("2026-11-14T10:00"), new Set())).toBe("OUTSIDE");
  });
});

describe("시각 입력 검증", () => {
  it("없는 날짜·24시는 거부(조용히 다음 달로 넘기지 않음)", () => {
    expect(parseOffsetIso("2026-02-31T10:00:00+09:00")).toBeNull();
    expect(parseOffsetIso("2026-04-31T10:00:00Z")).toBeNull();
    expect(parseOffsetIso("2026-11-09T24:00:00+09:00")).toBeNull();
    expect(parseOffsetIso("2026-13-01T10:00:00+09:00")).toBeNull();
    expect(parseOffsetIso("2026-00-10T10:00:00+09:00")).toBeNull();
  });
  it("정상 값·윤일은 허용", () => {
    expect(parseOffsetIso("2028-02-29T10:00:00+09:00")).not.toBeNull();
    expect(parseOffsetIso("2026-11-09T23:59")).toBeNull(); // 오프셋 필수
    expect(parseOffsetIso("2026-11-09T23:59:59+09:00")).not.toBeNull();
  });
});

describe("DB 트랜잭션", () => {
  it("성공 시 커밋, 실패 시 롤백, 동시 호출은 직렬화", async () => {
    const db = await createSqliteDb(":memory:");
    await db.exec("CREATE TABLE t (n INTEGER)");
    await db.transaction(async () => { await db.run("INSERT INTO t VALUES (1)"); });
    await expect(db.transaction(async () => { await db.run("INSERT INTO t VALUES (2)"); throw new Error("boom"); })).rejects.toThrow("boom");
    await Promise.all([1, 2, 3].map((i) => db.transaction(async () => { await db.run("INSERT INTO t VALUES (?)", [10 + i]); await Promise.resolve(); })));
    expect((await db.all<{ n: number }>("SELECT n FROM t ORDER BY n")).map((r) => r.n)).toEqual([1, 11, 12, 13]);
  });
  it("run 은 마지막 행 ID를 돌려줌", async () => {
    const db = await createSqliteDb(":memory:");
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER)");
    expect((await db.run("INSERT INTO t(n) VALUES (1)")).lastId).toBe(1);
    expect((await db.run("INSERT INTO t(n) VALUES (2)")).lastId).toBe(2);
  });
});

describe("동시 수집 로그", () => {
  it("두 원천을 동시에 수집해도 각자의 수집 로그 행이 갱신됨", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    const FIX = JSON.parse(readFileSync("tests/fixtures/standard-parking.sample.json", "utf8"));
    const rows = Array.isArray(FIX) ? FIX : FIX.rows ?? FIX.items;
    const rowsAdapter = (name: string, rs: Record<string, string>[]) => ({ sourceName: name, async *fetch() { for (const r of rs) yield r; } });
    const A = rowsAdapter("SRC_A", rows), B = rowsAdapter("SRC_B", rows.slice(0, 3));
    const now = new Date("2026-11-07T12:00:00+09:00");
    const [ra, rb] = await Promise.all([runSync(db, A, now), runSync(db, B, now)]);
    const logs = await db.all<{ source_name: string; status: string; records_received: number; finished_at: string | null }>("SELECT source_name, status, records_received, finished_at FROM source_sync_logs ORDER BY source_name");
    expect(logs.map((l) => l.source_name)).toEqual(["SRC_A", "SRC_B"]);
    expect(logs.every((l) => l.status !== "RUNNING" && l.finished_at)).toBe(true);
    expect(ra.status).not.toBe("FAILED"); expect(rb.status).not.toBe("FAILED");
    expect(ra.received).toBe(rows.length); expect(rb.received).toBe(3);
    expect(logs[0].records_received).toBe(ra.received);
    expect(logs[1].records_received).toBe(rb.received);
    // 종료 시각은 주입한 시작 시각 이후(시계 주입 시 결정적)
    expect(logs.every((l) => Date.parse(l.finished_at!) >= now.getTime() && Date.parse(l.finished_at!) < now.getTime() + 60_000)).toBe(true);
  });
});

describe("목업 기본값", () => {
  it("미설정이면 운영(production)에서 꺼지고 개발·테스트에서 켜짐, 명시값 우선", async () => {
    const { mockEnabled } = await import("@/server/mock");
    const env = process.env as Record<string, string | undefined>;
    const saved = { m: env.PARKING_MOCK_DATA, n: env.NODE_ENV };
    try {
      delete env.PARKING_MOCK_DATA;
      env.NODE_ENV = "production"; expect(mockEnabled()).toBe(false);
      env.NODE_ENV = "development"; expect(mockEnabled()).toBe(true);
      env.NODE_ENV = "production"; env.PARKING_MOCK_DATA = "true"; expect(mockEnabled()).toBe(true);
      env.NODE_ENV = "development"; env.PARKING_MOCK_DATA = "false"; expect(mockEnabled()).toBe(false);
    } finally {
      if (saved.m === undefined) delete env.PARKING_MOCK_DATA; else env.PARKING_MOCK_DATA = saved.m;
      env.NODE_ENV = saved.n;
    }
  });
});

describe("헬스체크", () => {
  it("DB 연결 시 200과 원천별 마지막 성공 수집 시각", async () => {
    const { setDb } = await import("@/server/db");
    const { resetAppDbForTest } = await import("@/server/app-db");
    const db = await createSqliteDb(":memory:"); await migrate(db);
    await db.run("INSERT INTO source_sync_logs(source_name, started_at, finished_at, status) VALUES ('X','2026-11-10T00:00:00Z','2026-11-10T00:01:00Z','SUCCESS')");
    setDb(db); resetAppDbForTest();
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // 표준데이터 수집 기록이 없으면 서비스는 되지만 'degraded'(외부 알림 대상), 컨테이너 재시작 대상(503)은 아님
    expect(body.status).toBe("degraded");
    expect(body.issues).toEqual(["STANDARD_SYNC_STALE"]);
    expect(body.schema.applied).toBe(body.schema.expected);
    expect(body.lastSuccessfulSync.X).toBe("2026-11-10T00:01:00Z");
    // 최근 표준데이터 수집이 있으면 ok
    const t = new Date(Date.now() - 3_600_000).toISOString();
    await db.run("INSERT INTO source_sync_logs(source_name, started_at, finished_at, status) VALUES ('DATA_GO_KR_15012896',?,?,'SUCCESS')", [t, t]);
    const ok = await (await GET()).json();
    expect(ok.status).toBe("ok");
    expect(ok.issues).toEqual([]);
    expect(JSON.stringify(ok)).not.toMatch(/token|key/i);
    setDb(undefined); resetAppDbForTest();
  });

  it("DB를 열 수 없으면 503", async () => {
    const { resetAppDbForTest } = await import("@/server/app-db");
    const { setDb } = await import("@/server/db");
    setDb(undefined);
    const env = process.env as Record<string, string | undefined>;
    const saved = env.DATABASE_PATH;
    env.DATABASE_PATH = `${process.execPath}/x/parking.sqlite`; // 상위 경로가 파일이라 열 수 없음
    resetAppDbForTest();
    try {
      const { GET } = await import("@/app/api/health/route");
      const res = await GET();
      expect(res.status).toBe(503);
      expect((await res.json()).issues).toEqual(["DB_UNAVAILABLE"]);
    } finally {
      if (saved === undefined) delete env.DATABASE_PATH; else env.DATABASE_PATH = saved;
      const { setDb } = await import("@/server/db");
      setDb(undefined); resetAppDbForTest();
    }
  });
});

describe("운영 모드 목적지 안내", () => {
  it("목업이 꺼져 있으면 목업 장소명을 안내하지 않고 현재 위치 사용을 안내", async () => {
    const { parseSearchParams } = await import("@/server/search");
    const env = process.env as Record<string, string | undefined>;
    const saved = env.PARKING_MOCK_DATA;
    try {
      env.PARKING_MOCK_DATA = "false";
      const r = parseSearchParams(new URLSearchParams({ destination: "서울시청", startAt: "2026-11-13T10:00:00+09:00", endAt: "2026-11-13T11:00:00+09:00" }));
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.code).toBe("DESTINATION_NOT_FOUND"); expect(r.message).not.toContain("목업"); expect(r.message).toContain("현재 위치"); }
    } finally {
      if (saved === undefined) delete env.PARKING_MOCK_DATA; else env.PARKING_MOCK_DATA = saved;
    }
  });
});
