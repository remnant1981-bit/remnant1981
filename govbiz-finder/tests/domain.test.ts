import { describe, expect, it } from "vitest";
import { computeStatus, isDeadlineSoon } from "@/domain/status";
import { canonicalizeUrl, normalizeAnnouncement, upsertAnnouncement, findDuplicate, ValidationError, type RawAnnouncement } from "@/domain/announcements";
import { evaluateMatch, evaluateRule, type Rule } from "@/domain/matching";
import { encryptText, decryptText, isValidBizNoChecksum, maskBizNo, normalizeBizNo } from "@/lib/crypto";
import { MockNtsAdapter, DataGoKrNtsAdapter, NtsError } from "@/server/nts";
import { runSource } from "@/collector/runner";
import { MockAdapter } from "@/collector/mock-adapter";
import { parseSearchParams, searchAnnouncements } from "@/domain/search";
import { freshDb, TODAY } from "./helpers";

describe("접수 상태 계산", () => {
  it("경계: 시작일·마감일 당일은 접수 중, 다음날 마감", () => {
    expect(computeStatus("2026-05-10", "2026-05-20", "2026-05-09").status).toBe("upcoming");
    expect(computeStatus("2026-05-10", "2026-05-20", "2026-05-10").status).toBe("open");
    expect(computeStatus("2026-05-10", "2026-05-20", "2026-05-20").status).toBe("open");
    expect(computeStatus("2026-05-10", "2026-05-20", "2026-05-21").status).toBe("closed");
  });
  it("날짜 없음 → 상태 확인 필요, 날짜 기반은 추정으로 표시, 원문 확인 상태는 confirmed", () => {
    expect(computeStatus(null, null, "2026-05-10")).toEqual({ status: "unknown", basis: "estimated" });
    expect(computeStatus("2026-05-10", "2026-05-20", "2026-05-15").basis).toBe("estimated");
    expect(computeStatus(null, null, "2026-05-10", "always")).toEqual({ status: "always", basis: "confirmed" });
    expect(computeStatus("2026-05-10", "2026-05-20", "2026-06-01", "open")).toEqual({ status: "open", basis: "confirmed" });
  });
  it("마감 임박", () => {
    expect(isDeadlineSoon("open", "2026-05-17", "2026-05-10", 7)).toBe(true);
    expect(isDeadlineSoon("open", "2026-05-18", "2026-05-10", 7)).toBe(false);
    expect(isDeadlineSoon("closed", "2026-05-11", "2026-05-10", 7)).toBe(false);
  });
});

const base: RawAnnouncement = { sourceNoticeId: "N1", url: "https://Example.org/a/?utm_source=x&b=2&a=1#frag", title: "[공고] 테스트 사업", organization: "기관A", categories: ["rnd", "bogus"], applicationStart: "2026-01-01", applicationEnd: "2026-01-31" };

describe("공고 표준화·검증", () => {
  it("URL 정규화(추적 파라미터·fragment 제거, 정렬) 및 위험 스킴 차단", () => {
    expect(canonicalizeUrl("https://Example.org/a/?utm_source=x&b=2&a=1#frag")).toBe("https://example.org/a/?a=1&b=2");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("data:text/html,x")).toBeNull();
  });
  it("필수값·날짜 검증, 알 수 없는 분야 제거", async () => {
    const n = await normalizeAnnouncement(base, "2026-01-10");
    expect(n.categories).toEqual(["rnd"]);
    expect(n.status).toBe("open");
    await expect(normalizeAnnouncement({ ...base, title: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(normalizeAnnouncement({ ...base, url: "ftp://x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(normalizeAnnouncement({ ...base, applicationStart: "2026-02-30" })).rejects.toBeInstanceOf(ValidationError);
    await expect(normalizeAnnouncement({ ...base, applicationStart: "2026-03-01", applicationEnd: "2026-02-01" })).rejects.toBeInstanceOf(ValidationError);
  });
  it("모르는 값은 추정하지 않고 null 로 둔다", async () => {
    const n = await normalizeAnnouncement({ ...base, applicationStart: null, applicationEnd: null }, "2026-01-10");
    expect(n.status).toBe("unknown");
    expect(n.targetSummary).toBeUndefined();
  });
});

describe("중복 판정·upsert", () => {
  it("동일 원천ID 재수집은 멱등, 변경 시 갱신+이력, 타 원천 동일 URL 은 병합(출처 보존)", async () => {
    const db = await freshDb({ mock: false });
    const n1 = await normalizeAnnouncement(base, "2026-01-10");
    const r1 = await upsertAnnouncement(db, "bizinfo", n1, "t");
    expect(r1.action).toBe("inserted");
    expect((await upsertAnnouncement(db, "bizinfo", n1, "t")).action).toBe("unchanged");
    const n2 = await normalizeAnnouncement({ ...base, supportSummary: "변경됨" }, "2026-01-10");
    expect((await upsertAnnouncement(db, "bizinfo", n2, "t")).action).toBe("updated");
    expect((await db.all("SELECT * FROM announcement_revisions")).length).toBe(1);
    // 다른 원천에서 같은 canonical URL
    const n3 = await normalizeAnnouncement({ ...base, sourceNoticeId: "ZZ" }, "2026-01-10");
    const r3 = await upsertAnnouncement(db, "k-startup", n3, "t");
    expect(r3).toMatchObject({ id: r1.id, action: "merged" });
    expect((await db.all("SELECT * FROM announcement_sources WHERE announcement_id=?", [r1.id])).length).toBe(2);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM announcements"))!.n).toBe(1);
  });
  it("정규화 사업명+기관+접수기간 일치로 중복 판정", async () => {
    const db = await freshDb({ mock: false });
    const a = await normalizeAnnouncement(base, "2026-01-10");
    await upsertAnnouncement(db, "bizinfo", a, "t");
    const b = await normalizeAnnouncement({ ...base, sourceNoticeId: "OTHER", url: "https://other.example/x", title: "테스트 사업 (재공고)" }, "2026-01-10");
    expect(await findDuplicate(db, "mss", b)).toMatchObject({ by: "title_org_period" });
  });
});

describe("수집 runner", () => {
  it("한 원천의 실패가 다른 원천을 막지 않고, 지수 백오프로 재시도하며 로그를 남긴다", async () => {
    const db = await freshDb({ mock: false });
    const delays: number[] = [];
    let calls = 0;
    const bad = { sourceId: "bizinfo", fetch: async () => { calls++; throw new Error("boom"); } };
    const r1 = await runSource(db, bad, { retries: 2, baseDelayMs: 100, sleep: async (ms) => { delays.push(ms); } });
    expect(r1.status).toBe("failed");
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
    const r2 = await runSource(db, new MockAdapter(TODAY));
    expect(r2.status).toBe("success");
    expect(r2.inserted).toBe(10);
    const src = await db.get<any>("SELECT last_error, last_success_at FROM data_sources WHERE id='bizinfo'");
    expect(src.last_error).toBe("boom");
    expect((await db.get<any>("SELECT last_success_at s FROM data_sources WHERE id='mock'")).s).toBeTruthy();
  });
  it("일부 항목 오류는 partial, 재실행은 멱등", async () => {
    const db = await freshDb({ mock: false });
    const items = [{ ...base }, { ...base, sourceNoticeId: "N2", url: "bad-url" }];
    const r = await runSource(db, { sourceId: "mock", fetch: async () => items });
    expect(r.status).toBe("partial");
    expect(r.errors[0]).toContain("N2");
    const again = await runSource(db, new MockAdapter(TODAY));
    const again2 = await runSource(db, new MockAdapter(TODAY));
    expect(again2.inserted).toBe(0);
    expect(again.inserted).toBe(10);
  });
});

describe("검색", () => {
  it("분야·지역(전국 포함)·상태·페이지네이션·정렬·LIKE 이스케이프", async () => {
    const db = await freshDb();
    const q = (o: Record<string, string>) => searchAnnouncements(db, parseSearchParams(o), TODAY);
    expect((await q({})).total).toBe(10);
    const rnd = await q({ category: "rnd" });
    expect(rnd.rows.every((r) => r.category_ids?.includes("rnd"))).toBe(true);
    // 경기도 선택 시 전국 + 경기도 + 시흥시 공고, 서울은 제외
    const gg = await q({ region: "경기도" });
    expect(gg.rows.some((r) => r.region_scope === "서울특별시")).toBe(false);
    expect(gg.rows.some((r) => r.region_scope === "전국")).toBe(true);
    expect(gg.rows.some((r) => r.region_scope === "경기도 시흥시")).toBe(true);
    // 시흥시 선택 시 시흥시 + 경기도 전체 + 전국
    const sh = await q({ region: "경기도 시흥시" });
    expect(sh.rows.some((r) => r.region_scope === "경기도")).toBe(true);
    expect((await q({ status: "open" })).rows.every((r) => r.application_status === "open")).toBe(true);
    const p1 = await q({ size: "4", page: "1" });
    const p3 = await q({ size: "4", page: "3" });
    expect(p1.pages).toBe(3);
    expect(p1.rows.length).toBe(4);
    expect(p3.rows.length).toBe(2);
    const dl = await q({ sort: "deadline", status: "open" });
    const ends = dl.rows.map((r) => r.application_end!);
    expect([...ends].sort()).toEqual(ends);
    expect((await q({ q: "%" })).total).toBe(0); // 와일드카드 이스케이프
    expect((await q({ q: "R&D 지원" })).total).toBeGreaterThan(0); // 토큰 AND
    expect((await q({ soon: "1" })).rows.every((r) => r.application_status === "open")).toBe(true);
  });
  it("잘못된 쿼리 값은 무시되고 안전한 기본값으로 대체", () => {
    const p = parseSearchParams({ category: "x,rnd", sort: "evil", page: "-5", size: "9999", from: "2026-13-01" });
    expect(p).toMatchObject({ category: ["rnd"], sort: "latest", page: 1, pageSize: 50, from: "" });
  });
});

const rule = (field_key: string, operator: string, expected: unknown, confidence = 1): Rule => ({ field_key, operator, expected_value: JSON.stringify(expected), confidence });

describe("기업 적합성(MET/NOT_MET/UNKNOWN)", () => {
  const T = "2026-06-01";
  it("미입력은 UNKNOWN(확인 필요), 명백한 불일치만 NOT_MET", () => {
    expect(evaluateRule(rule("region_sido", "in", ["경기도"]), {}, T).state).toBe("UNKNOWN");
    expect(evaluateRule(rule("region_sido", "in", ["경기도"]), { region_sido: "경기도" }, T).state).toBe("MET");
    expect(evaluateRule(rule("region_sido", "in", ["경기도"]), { region_sido: "서울특별시" }, T).state).toBe("NOT_MET");
    expect(evaluateRule(rule("venture", "eq", "yes"), { venture_status: "no" }, T).state).toBe("NOT_MET");
    expect(evaluateRule(rule("venture", "eq", "yes"), { venture_status: "" }, T).state).toBe("UNKNOWN");
  });
  it("업력 경계: 정확히 3년은 '3년 이내' 충족, 3년 초과는 미충족, 잘못된 날짜는 확인 필요", () => {
    const r = rule("business_age_years", "lte", 3);
    expect(evaluateRule(r, { established_at: "2023-06-01" }, T).state).toBe("MET");
    expect(evaluateRule(r, { established_at: "2023-05-01" }, T).state).toBe("NOT_MET");
    expect(evaluateRule(r, { established_at: "2027-01-01" }, T).state).toBe("UNKNOWN");
  });
  it("종합 판정: 미충족 있으면 미충족 가능성, 없고 확인 필요 있으면 확인 필요, 모두 충족이면 충족 가능성", () => {
    const rules = [rule("region_sido", "in", ["경기도"]), rule("venture", "eq", "yes")];
    expect(evaluateMatch(rules, { region_sido: "서울특별시" }, T).overall).toBe("likely_not_met");
    expect(evaluateMatch(rules, { region_sido: "경기도" }, T).overall).toBe("needs_check");
    expect(evaluateMatch(rules, { region_sido: "경기도", venture_status: "yes" }, T).overall).toBe("likely_met");
    expect(evaluateMatch([], null, T).overall).toBe("needs_check");
  });
  it("미입력으로 점수가 과도하게 낮아지지 않는다(UNKNOWN 중립 50%)", () => {
    const rules = [rule("region_sido", "in", ["경기도"]), rule("venture", "eq", "yes"), rule("export", "eq", "yes")];
    const empty = evaluateMatch(rules, {}, T);
    expect(empty.overall).toBe("needs_check");
    expect(empty.score).toBe(50);
    expect(evaluateMatch(rules, { region_sido: "서울특별시" }, T).score!).toBeLessThan(empty.score!);
  });
  it("신뢰도 낮은 규칙은 미충족으로 확정하지 않는다", () => {
    expect(evaluateRule(rule("venture", "eq", "yes", 0.3), { venture_status: "no" }, T).state).toBe("UNKNOWN");
  });
  it("알 수 없는 조건 키는 자동 판정하지 않음", () => {
    expect(evaluateRule(rule("weird", "eq", 1), { region_sido: "경기도" }, T).state).toBe("UNKNOWN");
  });
});

describe("암호화·사업자번호", () => {
  it("AES-GCM 왕복, 매번 다른 암호문, 변조 감지", async () => {
    const c1 = await encryptText("1234567891");
    const c2 = await encryptText("1234567891");
    expect(c1).not.toBe(c2);
    expect(c1).not.toContain("1234567891");
    expect(await decryptText(c1)).toBe("1234567891");
    const tampered = c1.slice(0, -4) + "AAAA";
    await expect(decryptText(tampered)).rejects.toThrow();
  });
  it("정규화·체크섬·마스킹", () => {
    expect(normalizeBizNo("123-45-67891")).toBe("1234567891");
    expect(normalizeBizNo("12-345")).toBeNull();
    expect(isValidBizNoChecksum("1234567891")).toBe(true);
    expect(isValidBizNoChecksum("1234567890")).toBe(false);
    expect(maskBizNo("1234567891")).toBe("123-**-***91");
  });
});

describe("국세청 상태조회 adapter", () => {
  it("mock 은 isMock=true 로 표시된다", async () => {
    const r = await new MockNtsAdapter().lookupStatus("1234567891");
    expect(r.isMock).toBe(true);
    expect(r.statusText).toBe("계속사업자");
  });
  it("실 adapter 응답 매핑(가짜 fetch)과 오류 분류", async () => {
    const ok = new DataGoKrNtsAdapter("k", (async () => new Response(JSON.stringify({ data: [{ b_no: "1234567891", b_stt: "폐업자", b_stt_cd: "03", tax_type: "부가가치세 일반과세자", end_dt: "20240131" }] }))) as typeof fetch);
    const r = await ok.lookupStatus("1234567891");
    expect(r).toMatchObject({ statusCode: "03", closedAt: "2024-01-31", isMock: false });
    const rl = new DataGoKrNtsAdapter("k", (async () => new Response("", { status: 429 })) as typeof fetch);
    await expect(rl.lookupStatus("1234567891")).rejects.toMatchObject({ kind: "rate_limit" });
    const net = new DataGoKrNtsAdapter("k", (async () => { throw new Error("x"); }) as typeof fetch);
    await expect(net.lookupStatus("1234567891")).rejects.toBeInstanceOf(NtsError);
  });
});
