import { describe, expect, it } from "vitest";
import { regionOf, isValidSigungu } from "@/domain/region";
import { summarizeFee, areaIndex, areaLots, lotSummary, resetAreaCacheForTest } from "@/server/area";
import { createSqliteDb, migrate } from "@/server/db";

describe("주소 → 지역", () => {
  it.each([
    ["서울특별시 중구 세종대로 110", "서울특별시", "중구"],
    ["경기도 수원시 장안구 정조로 1", "경기도", "수원시"],
    ["강원특별자치도강릉시 교동 1", "강원특별자치도", "강릉시"],
    ["경상북도 군위군 군위읍", "경상북도", "군위군"],
    ["경기도 구리시 인창동", "경기도", "구리시"],
    ["충청북도 청주시상당구 상당로", "충청북도", "청주시"],
    ["세종특별자치시 한솔동 1", "세종특별자치시", "세종특별자치시"],
    ["전남광주통합특별시 북구 1", "전남광주통합특별시", "북구"],
  ])("%s → %s %s", (a, sido, sigungu) => expect(regionOf(a)).toEqual({ sido, sigungu }));

  it("오타·불명확한 주소는 추정하지 않고 제외", () => {
    for (const a of ["전븍특별자치도 전주시", "경상남동 양산시", "충청남도 홍성읍 1", "중구 세종대로", "", null, "서울특별시"]) expect(regionOf(a)).toBeNull();
  });
  it("경로 조각 검증", () => {
    expect(isValidSigungu("중구")).toBe(true);
    for (const s of ["../etc", "중구<script>", "abc", "중"]) expect(isValidSigungu(s)).toBe(false);
  });
});

const R = (rule_type: string, amount: number | null, duration_minutes: number | null, valid_day_type = "WEEKDAY", start_time: string | null = null) => ({ rule_type, amount, duration_minutes, valid_day_type, start_time });
describe("대표 요금 요약", () => {
  it("평일 기본요금 우선, 일 최대 포함", () => {
    expect(summarizeFee([R("BASE", 500, 30, "EVERYDAY"), R("BASE", 1000, 30), R("DAILY_MAX", 10000, null)])).toEqual({ kind: "PAID", base: { minutes: 30, amount: 1000 }, dailyMax: 10000 });
  });
  it("무료 규칙만 있으면 무료, 규칙 없음·시간대 한정·정기권만은 정보 없음(무료 아님)", () => {
    expect(summarizeFee([R("FREE", null, null, "EVERYDAY")]).kind).toBe("FREE");
    expect(summarizeFee([]).kind).toBe("UNKNOWN");
    expect(summarizeFee([R("BASE", 1000, 30, "WEEKDAY", "09:00")]).kind).toBe("UNKNOWN");
    expect(summarizeFee([R("SEASON_PASS", 60000, null)]).kind).toBe("UNKNOWN");
    expect(summarizeFee([R("FREE", null, null, "EVERYDAY"), R("ADDITIONAL", 500, 10)]).kind).toBe("UNKNOWN"); // 유료 흔적이 있으면 무료로 단정하지 않음
  });
});

async function seed() {
  const db = await createSqliteDb(":memory:"); await migrate(db);
  const ins = async (name: string, road: string | null, src = "DATA_GO_KR_15012896", status = "ACTIVE") => (await db.run(
    "INSERT INTO parking_lots(source_name, source_record_id, name, parking_type, ownership_type, road_address, latitude, longitude, collected_at, data_status, created_at, updated_at) VALUES (?,?,?,'OFF_STREET','PUBLIC',?,37.56,126.97,'2026-11-10T00:00:00Z',?,'2026-11-10T00:00:00Z','2026-11-10T00:00:00Z')",
    [src, name, name, road, status])).lastId;
  const a = await ins("가 공영", "서울특별시 중구 세종대로 1");
  await db.run("INSERT INTO fee_rules(parking_lot_id, rule_type, amount, duration_minutes, valid_day_type) VALUES (?, 'BASE', 1000, 30, 'WEEKDAY')", [a]);
  await ins("나 공영", "서울특별시 중구 을지로 2");
  await ins("다 공영", "서울특별시 종로구 1");
  await ins("목업", "서울특별시 중구 3", "MOCK");
  await ins("제외", "서울특별시 중구 4", "DATA_GO_KR_15012896", "EXCLUDED_SCOPE");
  await ins("오타", "전븍특별자치도 전주시 1");
  return { db, a };
}

describe("지역 목록", () => {
  it("실서비스 원천·제외 아닌 시설만, 지역별 집계", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.PARKING_MOCK_DATA; env.PARKING_MOCK_DATA = "false"; resetAreaCacheForTest();
    try {
      const { db, a } = await seed();
      const idx = await areaIndex(db);
      expect(idx).toEqual([{ sido: "서울특별시", count: 3, sigungu: [{ name: "종로구", count: 1 }, { name: "중구", count: 2 }] }]);
      const lots = (await areaLots(db, { sido: "서울특별시", sigungu: "중구" }))!;
      expect(lots.map((l) => l.name)).toEqual(["가 공영", "나 공영"]);
      expect(lots[0].fee).toEqual({ kind: "PAID", base: { minutes: 30, amount: 1000 }, dailyMax: null });
      expect(lots[1].fee.kind).toBe("UNKNOWN");
      expect(await areaLots(db, { sido: "서울특별시", sigungu: "강남구" })).toBeNull();
      expect((await lotSummary(db, a))?.region).toEqual({ sido: "서울특별시", sigungu: "중구" });
    } finally { if (saved === undefined) delete env.PARKING_MOCK_DATA; else env.PARKING_MOCK_DATA = saved; resetAreaCacheForTest(); }
  });
});

describe("robots·sitemap", () => {
  it("검색·비교·관리자·API는 수집 제외, 사이트맵 주소 포함", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.SITE_URL; env.SITE_URL = "https://parking.example/";
    try {
      const robots = (await import("@/app/robots")).default();
      const rule = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
      expect(rule.disallow).toEqual(expect.arrayContaining(["/admin", "/api/", "/search", "/compare", "/lang"]));
      expect(robots.sitemap).toBe("https://parking.example/sitemap.xml");
    } finally { if (saved === undefined) delete env.SITE_URL; else env.SITE_URL = saved; }
  });

  it("사이트맵: 지역·상세 포함, 목업·제외 시설·검색 주소 없음", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { m: env.PARKING_MOCK_DATA, s: env.SITE_URL }; env.PARKING_MOCK_DATA = "false"; env.SITE_URL = "https://parking.example";
    const { setDb } = await import("@/server/db");
    const { resetAppDbForTest } = await import("@/server/app-db");
    resetAreaCacheForTest();
    try {
      const { db, a } = await seed();
      setDb(db); resetAppDbForTest();
      const urls = (await (await import("@/app/sitemap")).default()).map((e) => e.url);
      expect(urls).toContain("https://parking.example/area");
      expect(urls).toContain(`https://parking.example/area/${encodeURIComponent("서울특별시")}/${encodeURIComponent("중구")}`);
      expect(urls).toContain(`https://parking.example/lots/${a}`);
      expect(urls.filter((u) => u.includes("/lots/"))).toHaveLength(4); // 가·나·다 + 오타 주소 시설(상세는 존재)
      expect(urls.some((u) => u.includes("/search"))).toBe(false);
    } finally {
      env.PARKING_MOCK_DATA = saved.m; env.SITE_URL = saved.s;
      if (saved.m === undefined) delete env.PARKING_MOCK_DATA; if (saved.s === undefined) delete env.SITE_URL;
      setDb(undefined); resetAppDbForTest(); resetAreaCacheForTest();
    }
  });
});
