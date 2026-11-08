import { describe, expect, it } from "vitest";
import { computeStatus, isDeadlineSoon } from "@/domain/status";
import { canonicalizeUrl, normalizeAnnouncement, upsertAnnouncement, findDuplicate, ValidationError, type RawAnnouncement } from "@/domain/announcements";
import { evaluateMatch, evaluateRule, type Rule } from "@/domain/matching";
import { encryptText, decryptText, isValidBizNoChecksum, maskBizNo, normalizeBizNo } from "@/lib/crypto";
import { MockNtsAdapter, DataGoKrNtsAdapter, NtsError } from "@/server/nts";
import { runSource } from "@/collector/runner";
import { MockAdapter } from "@/collector/mock-adapter";
import { parseSearchParams, searchAnnouncements, toQueryString } from "@/domain/search";
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
    const b = await normalizeAnnouncement({ ...base, sourceNoticeId: "OTHER", url: "https://other.example/x", title: "[공고] 테스트 사업 (재공고)" }, "2026-01-10");
    expect(await findDuplicate(db, "mss", b)).toMatchObject({ by: "title_org_period" });
  });
});

describe("중복 판정: 지역만 다른 공고는 합치지 않는다", () => {
  it("지역 접두어·지역 범위가 다르면 별개, 같은 공고의 재공고 표기는 병합", async () => {
    const db = await freshDb({ mock: false });
    const mk = (id: string, title: string, region: string) => normalizeAnnouncement({ ...base, sourceNoticeId: id, url: `https://example.org/${id}`, title, regionScope: region }, "2026-01-10");
    await upsertAnnouncement(db, "bizinfo", await mk("A", "[서울] 청년일자리도약장려금 모집 공고", "서울특별시"), "t");
    const b = await upsertAnnouncement(db, "bizinfo", await mk("B", "[충북] 청년일자리도약장려금 모집 공고", "충청북도"), "t");
    expect(b.action).toBe("inserted");
    // 접두어가 달라도 지역 범위가 같으면 서로 다른 사업명이므로 병합되지 않음
    const c = await upsertAnnouncement(db, "bizinfo", await mk("C", "[서울] 청년일자리도약장려금 모집 공고(재공고)", "서울특별시"), "t");
    expect(c.action).toBe("merged");
    const d = await upsertAnnouncement(db, "bizinfo", await mk("D", "[서울] 다른 사업 모집 공고", "서울특별시"), "t");
    expect(d.action).toBe("inserted");
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM announcements"))!.n).toBe(3);
  });
});

describe("잘못된 병합 흔적 정리", () => {
  it("공고로 독립된 원천 공고ID의 출처 연결은 다른 공고에서 제거된다", async () => {
    const db = await freshDb({ mock: false });
    const a = await upsertAnnouncement(db, "bizinfo", await normalizeAnnouncement({ ...base, sourceNoticeId: "A", url: "https://example.org/a" }, "2026-01-10"), "t");
    // 과거 규칙으로 B 가 A 에 병합된 상태를 재현
    await db.run("INSERT INTO announcement_sources(announcement_id, source_id, source_notice_id, url, first_seen_at) VALUES (?,?,?,?,?)", [a.id, "bizinfo", "B", "https://example.org/b", "2026-01-01T00:00:00Z"]);
    const b = await upsertAnnouncement(db, "bizinfo", await normalizeAnnouncement({ ...base, sourceNoticeId: "B", url: "https://example.org/b", title: "다른 사업 공고", applicationStart: "2026-02-01", applicationEnd: "2026-02-28" }, "2026-01-10"), "t");
    expect(b.action).toBe("inserted");
    const rows = await db.all<{ announcement_id: string; source_notice_id: string }>("SELECT announcement_id, source_notice_id FROM announcement_sources ORDER BY source_notice_id");
    expect(rows).toEqual([{ announcement_id: a.id, source_notice_id: "A" }, { announcement_id: b.id, source_notice_id: "B" }]);
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
  it("판정 정확도: 정보를 입력할수록 높아지고, 미입력 항목은 따로 집계된다", () => {
    const rules = [rule("region_sido", "in", ["경기도"]), rule("venture", "eq", "yes"), { ...rule("enterprise_size", "in", ["중소기업"]), confidence: 0.5 }];
    const a = evaluateMatch(rules, { region_sido: "경기도" }, T);
    expect(a.accuracy).toBe(33);
    expect(a.missingLabels).toEqual(["벤처기업 여부", "기업 규모"]);
    const b = evaluateMatch(rules, { region_sido: "경기도", venture_status: "yes", enterprise_size: "중소기업" }, T);
    expect(b.accuracy).toBe(83); // 신뢰도 0.5 규칙은 절반만 반영
    expect(b.missingLabels).toEqual([]);
    expect(evaluateMatch([], null, T).accuracy).toBeNull();
    // 원문 해석 불가(미입력 아님)는 missing 으로 세지 않음
    expect(evaluateRule(rule("business_age_years", "lte", 3), { established_at: "2027-01-01" }, T).missing).toBeUndefined();
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

import { parseBlocks, shortSummary } from "@/lib/format";
describe("본문 포맷", () => {
  it("☞/※/- 줄을 소제목·주석·글머리표로 나누고 HTML 은 해석하지 않는다", () => {
    const b = parseBlocks("소개 문장입니다.\n\n☞ 지원 대상\n- 중소기업\nㆍ 제조업\n※ 자세한 내용은 공고문 참조\n<b>x</b>");
    expect(b.map((x) => x.type)).toEqual(["para", "heading", "bullet", "bullet", "note", "para"]);
    expect(b[5].text).toBe("<b>x</b>"); // 텍스트 그대로(렌더 시 React 가 이스케이프)
  });
  it("요약은 첫 문장 기준으로 길이를 제한한다", () => {
    expect(shortSummary("짧은 문장 하나뿐입니다.")).toBe("짧은 문장 하나뿐입니다.");
    expect(shortSummary("가".repeat(300)).length).toBeLessThanOrEqual(111);
    expect(shortSummary("")).toBe("");
  });
});

import { regionRulesFor, loadRules, searchWithMatches } from "@/server/recommend";
describe("지역 자동 판정과 해당 가능 필터", () => {
  it("공고 지역 표기에서 규칙 생성(복수 지역·전국은 생성하지 않음)", () => {
    expect(regionRulesFor("전국")).toEqual([]);
    expect(regionRulesFor("경기도 외 1곳")).toEqual([]);
    expect(regionRulesFor("전남광주")).toEqual([]);
    expect(regionRulesFor("경기도").map((r) => r.field_key)).toEqual(["region_sido"]);
    const r = regionRulesFor("경기도 시흥시");
    expect(r.map((x) => x.field_key)).toEqual(["region_sido", "region_sigungu"]);
    expect(r[1].confidence).toBeLessThan(0.6); // 시군구 불일치는 미충족으로 단정하지 않음
  });
  it("복수 지역 공고: 포함 지역이면 충족, 포함되지 않으면 미충족, 해석 불가 항목이 있으면 판정하지 않음", () => {
    const T = "2026-06-01";
    const r = regionRulesFor("서울특별시·경기도");
    expect(r).toHaveLength(1);
    expect(evaluateMatch(r, { region_sido: "경기도" }, T).overall).toBe("likely_met");
    expect(evaluateMatch(r, { region_sido: "부산광역시" }, T).overall).toBe("likely_not_met");
    expect(evaluateMatch(r, {}, T).overall).toBe("needs_check");
    expect(regionRulesFor("전남광주·서울특별시")).toEqual([]);
  });
  it("복수 지역 공고는 포함된 어느 지역으로 검색해도 나온다", async () => {
    const db = await freshDb({ mock: false });
    const n = await normalizeAnnouncement({ ...base, sourceNoticeId: "R1", url: "https://example.org/r1", regionScope: "서울특별시·경기도·부산광역시" }, "2026-01-10");
    await upsertAnnouncement(db, "bizinfo", n, "t");
    for (const region of ["서울특별시", "경기도", "경기도 시흥시", "부산광역시"]) {
      expect((await searchAnnouncements(db, parseSearchParams({ region }), "2026-01-10")).total, region).toBe(1);
    }
    expect((await searchAnnouncements(db, parseSearchParams({ region: "대구광역시" }), "2026-01-10")).total).toBe(0);
  });
  it("다른 시도 공고는 미충족, 같은 시도는 충족, 시군구 표기 차이는 허용", () => {
    const T = "2026-06-01";
    const rules = regionRulesFor("경기도 시흥시");
    expect(evaluateMatch(rules, { region_sido: "서울특별시", region_sigungu: "강남구" }, T).overall).toBe("likely_not_met");
    expect(evaluateMatch(rules, { region_sido: "경기도", region_sigungu: "시흥" }, T).overall).toBe("likely_met");
    expect(evaluateMatch(rules, { region_sido: "경기도", region_sigungu: "수원시" }, T).overall).toBe("needs_check");
    expect(evaluateMatch(rules, { region_sido: "경기도" }, T).overall).toBe("needs_check");
  });
  it("eligible 필터: 미충족 제외, 확인 필요·충족은 유지, 기업정보 없으면 무시", async () => {
    const db = await freshDb();
    const base = parseSearchParams({});
    const all = await searchWithMatches(db, base, { region_sido: "서울특별시" }, TODAY);
    const only = await searchWithMatches(db, { ...base, eligible: true }, { region_sido: "서울특별시" }, TODAY);
    expect(only.total).toBeLessThan(all.total);
    expect(only.rows.every((r) => r.match!.overall !== "likely_not_met")).toBe(true);
    expect(all.rows.some((r) => r.match!.overall === "likely_not_met")).toBe(true);
    expect(only.rows.some((r) => r.match!.overall === "needs_check")).toBe(true); // 확인 필요는 숨기지 않음
    const noCompany = await searchWithMatches(db, { ...base, eligible: true }, null, TODAY);
    expect(noCompany.total).toBe(all.total);
    expect(parseSearchParams({ eligible: "1" }).eligible).toBe(true);
    expect(toQueryString({ eligible: true })).toBe("eligible=1");
  });
  it("loadRules: 공고에 지역 조건이 이미 있으면 중복 생성하지 않는다", async () => {
    const db = await freshDb();
    const row = (await db.get<{ id: string }>("SELECT id FROM announcements WHERE title LIKE '%경기도 중소기업 정책자금%'"))!;
    const rules = (await loadRules(db, [row.id])).get(row.id)!;
    expect(rules.filter((x) => x.field_key === "region_sido")).toHaveLength(1);
  });
});

import { textRulesFor } from "@/server/recommend";
import { validateProfile } from "@/server/company";
describe("본문 기반 규칙(AI 미사용)과 확장 프로필", () => {
  const T = "2026-06-01";
  it("지원대상 규모·업력·인증을 정규식으로 추출하고 신뢰도는 낮게(불일치=확인 필요)", () => {
    const r = textRulesFor({ title: "[경기] 여성기업 판로 지원", target_summary: "중소기업", original_text: "☞ 창업 7년 이내 중소·중견기업\n※ 자세한 내용 공고문 참조" });
    const keys = r.map((x) => x.field_key);
    expect(keys).toEqual(["enterprise_size", "business_age_years", "certification"]);
    expect(JSON.parse(r[0].expected_value)).toEqual(expect.arrayContaining(["중소기업", "소상공인", "중견기업"]));
    expect(r[1].source_excerpt).toContain("창업 7년 이내");
    expect(r.every((x) => (x.confidence ?? 1) < 0.6)).toBe(true);
    // 충족이면 MET, 불일치는 미충족으로 단정하지 않음
    expect(evaluateMatch(r, { enterprise_size: "중소기업", established_at: "2022-01-01", certifications: "여성기업" }, T).overall).toBe("likely_met");
    expect(evaluateMatch(r, { enterprise_size: "대기업", established_at: "2000-01-01", certifications: "" }, T).overall).toBe("needs_check");
  });
  it("판정할 수 없는 대상 표기는 규칙을 만들지 않는다", () => {
    expect(textRulesFor({ target_summary: "창업벤처", original_text: "" })).toEqual([]);
    expect(textRulesFor({ target_summary: null, original_text: "업력 무관" })).toEqual([]);
  });
  it("확장 프로필 검증: 복수 선택은 허용 목록만, 쉼표 문자열로 저장", () => {
    const p = validateProfile({ enterprise_size: "중소기업", certifications: ["이노비즈", "여성기업"], interest_categories: "rnd,export", youth_ceo: "yes", has_patent: "no" });
    expect(p).toMatchObject({ enterprise_size: "중소기업", certifications: "이노비즈,여성기업", interest_categories: "rnd,export", youth_ceo: "yes", has_patent: "no" });
    expect(validateProfile({ certifications: "" }).certifications).toBeNull();
    expect(() => validateProfile({ certifications: ["가짜인증"] })).toThrow();
    expect(() => validateProfile({ interest_categories: "nope" })).toThrow();
    expect(() => validateProfile({ enterprise_size: "거대기업" })).toThrow();
  });
  it("조건 충족만(metOnly)·전체 평가(상한 없이)·집계", async () => {
    const db = await freshDb();
    const c = { region_sido: "경기도", research_institute_status: "yes", business_status: "계속사업자" };
    const all = await searchWithMatches(db, parseSearchParams({ size: "2", sort: "fit" }), c, TODAY);
    const met = await searchWithMatches(db, parseSearchParams({ met: "1", size: "50" }), c, TODAY);
    expect(all.counts!.likely_met + all.counts!.needs_check + all.counts!.likely_not_met).toBe(10); // 전체 평가
    expect(all.pages).toBe(5);
    expect(met.total).toBe(all.counts!.likely_met);
    expect(met.rows.every((r) => r.match!.overall === "likely_met")).toBe(true);
    expect(met.total).toBeGreaterThan(0);
  });
});

import { titleSigungu } from "@/server/recommend";
describe("공고명 기반 시/군/구 판정", () => {
  const T = "2026-06-01";
  it("공고명 앞의 시/군/구를 추출하고 지명이 아닌 단어는 제외", () => {
    expect(titleSigungu("[경기] 안성시 2026년 도시재생 창업지원사업 참여자 추가모집 공고")).toEqual(["안성시"]);
    expect(titleSigungu("[경기] 수원시ㆍ용인시ㆍ화성시 2026년 청년일자리도약장려금(수도권형)")).toEqual(["수원시", "용인시", "화성시"]);
    expect(titleSigungu("[인천] 서구 2026년 제품인증획득 지원사업")).toEqual(["서구"]);
    expect(titleSigungu("[서울] 강남구 2026년 청년일자리도약장려금")).toEqual(["강남구"]);
    expect(titleSigungu("[경기] 연구개발 지원사업")).toEqual([]);
    expect(titleSigungu("[경기] 2026년 중소기업 육성자금")).toEqual([]);
    expect(titleSigungu("[충북] 2026년 청년일자리도약장려금 사업")).toEqual([]);
    expect(titleSigungu("2026년 가상 지원사업")).toEqual([]);
  });
  it("시흥시 기업에게 안성시·파주시 공고는 조건 충족이 아니고, 시흥시 공고는 충족", () => {
    const company = { region_sido: "경기도", region_sigungu: "시흥시" };
    const ev = (title: string) => {
      const rules = [...regionRulesFor("경기도"), ...textRulesFor({ title, region_scope: "경기도" })];
      return evaluateMatch(rules, company, T).overall;
    };
    expect(ev("[경기] 안성시 2026년 도시재생 창업지원사업")).toBe("likely_not_met");
    expect(ev("[경기] 파주시 2026년 파주청년창업지원센터 청년창업 멘토링")).toBe("likely_not_met");
    expect(ev("[경기] 시흥시 2026년 중소기업 판로 지원")).toBe("likely_met");
    expect(ev("[경기] 2026년 경기도 중소기업 정책자금")).toBe("likely_met");
    // 기업이 시/군/구를 입력하지 않았으면 확인 필요(숨기지 않음)
    expect(evaluateMatch([...regionRulesFor("경기도"), ...textRulesFor({ title: "[경기] 안성시 공고", region_scope: "경기도" })], { region_sido: "경기도" }, T).overall).toBe("needs_check");
  });
});
describe("시/도 줄임말은 시/군/구로 보지 않음", () => {
  it("[서울] 서울시 … / [부산] 부산시 … 는 시/군/구 규칙을 만들지 않는다", () => {
    expect(textRulesFor({ title: "[서울] 서울시 소상공인 마케팅 지원", region_scope: "서울특별시" }).filter((r) => r.field_key === "region_sigungu")).toEqual([]);
    expect(textRulesFor({ title: "[부산] 부산시 창업 지원", region_scope: "부산광역시" }).filter((r) => r.field_key === "region_sigungu")).toEqual([]);
    expect(textRulesFor({ title: "[경기] 광주시 기업 지원", region_scope: "경기도" }).map((r) => r.field_key)).toContain("region_sigungu"); // 경기도 광주시는 실제 시
  });
});

describe("업종 분야 판정", () => {
  it("공고명·대상의 수혜 업종을 찾고, 가공·제조 혼재·범용 문구는 제외/약화", async () => {
    const { industryTargets, textRulesFor } = await import("@/server/recommend");
    expect(industryTargets("[경기] 시흥시 2026년 친환경농산물 인증확대사업 신청 연장 공고")).toEqual([["농림축수산업", 0.7]]);
    expect(industryTargets("[경기] 2026년 AI콘텐츠 제작 및 마케팅 활용 교육 참여업체 모집 공고")).toEqual([]);
    expect(industryTargets("농산물 가공업체 판로 지원")).toEqual([]);
    expect(industryTargets("관광사업체 및 농가 상생 지원")).toEqual([["농림축수산업", 0.5], ["관광·숙박·음식점", 0.5]]);
    const r = textRulesFor({ title: "[경기] 시흥시 친환경농산물 인증확대사업", target_summary: "중소기업", region_scope: "경기도" });
    expect(r.find((x) => x.field_key === "industry_group")).toMatchObject({ expected_value: JSON.stringify(["농림축수산업"]), confidence: 0.7 });
  });
  it("기업 업종 분야가 다르면 미충족, 미입력이면 확인 필요(업종명에서 추정 가능하면 사용)", async () => {
    const { inferIndustryGroup } = await import("@/domain/matching");
    const rule: Rule = { field_key: "industry_group", operator: "in", expected_value: JSON.stringify(["농림축수산업"]), confidence: 0.7 };
    expect(evaluateRule(rule, { industry_group: "제조업" }, TODAY).state).toBe("NOT_MET");
    expect(evaluateRule(rule, { industry_group: "농림축수산업" }, TODAY).state).toBe("MET");
    expect(evaluateRule(rule, {}, TODAY)).toMatchObject({ state: "UNKNOWN", missing: true });
    expect(evaluateRule(rule, { industry_name: "금속가공 제조업" }, TODAY).state).toBe("NOT_MET");
    expect(inferIndustryGroup("경영 컨설팅")).toBeNull();
    expect(evaluateRule({ ...rule, confidence: 0.5 }, { industry_group: "제조업" }, TODAY).state).toBe("UNKNOWN");
  });
});

describe("공고별 조건 직접 확인", () => {
  it("직접 확인 결과는 해당 공고에만 적용되고 정확도를 100으로 만든다", async () => {
    const { checkableConditions } = await import("@/domain/matching");
    const rules: Rule[] = [{ field_key: "enterprise_size", operator: "in", expected_value: JSON.stringify(["중소기업"]), confidence: 0.5 }];
    const base = evaluateMatch(rules, { enterprise_size: "중소기업" }, TODAY, "A1");
    expect(base.accuracy).toBe(50);
    expect(checkableConditions(base).map((x) => x.fieldKey)).toEqual(["enterprise_size"]);
    const c = { enterprise_size: "중소기업", checks: { A1: { enterprise_size: "yes" as const } } };
    const yes = evaluateMatch(rules, c, TODAY, "A1");
    expect(yes).toMatchObject({ overall: "likely_met", accuracy: 100 });
    expect(checkableConditions(yes)[0].userChecked).toBe("yes");
    expect(evaluateMatch(rules, c, TODAY, "B2").accuracy).toBe(50); // 다른 공고에는 영향 없음
    const no = evaluateMatch(rules, { checks: { A1: { enterprise_size: "no" as const } } }, TODAY, "A1");
    expect(no.overall).toBe("likely_not_met");
    expect(no.missingLabels).toEqual([]); // 직접 확인하면 미입력 안내도 사라짐
  });
  it("비회원 쿠키 형식: 잘못된 값 무시, 50건 상한", async () => {
    const { decodeChecks, encodeChecks } = await import("@/lib/guest-checks");
    const id = "0123456789abcdef0123456789abcdef";
    expect(decodeChecks(encodeChecks([[id, "venture", "yes"], [id, "export", "no"]]))).toEqual({ [id]: { venture: "yes", export: "no" } });
    expect(decodeChecks("bad~x~y|" + id + "~BAD~y|" + id + "~venture~z")).toEqual({});
    const many = Array.from({ length: 60 }, (_, i) => [`${id.slice(0, 30)}${String(i).padStart(2, "0")}`, "venture", "yes"] as [string, string, "yes"]);
    expect(Object.keys(decodeChecks(encodeChecks(many))).length).toBe(50);
  });
});

describe("기술 분야 판정", () => {
  it("6G 공모는 통신 분야, 수소·극저온 기업이면 해당 안 됨 / 도입·활용 공고는 확인 필요로만", async () => {
    const { textRulesFor } = await import("@/server/recommend");
    const r = textRulesFor({ title: "6G 서비스 시나리오 공모전 - 6G 시연 기획 Track 공고", target_summary: "중소기업", region_scope: "전국" }).find((x) => x.field_key === "tech_field")!;
    expect(r).toMatchObject({ expected_value: JSON.stringify(["통신·네트워크(5G/6G)"]), confidence: 0.6 });
    const smg = { tech_keywords: "액체수소, 극저온 펌프", industry_name: "기계 제조업" };
    expect(evaluateRule(r, smg, TODAY).state).toBe("NOT_MET");
    expect(evaluateRule(r, { tech_fields: "통신·네트워크(5G/6G)" }, TODAY).state).toBe("MET");
    expect(evaluateRule(r, {}, TODAY)).toMatchObject({ state: "UNKNOWN", missing: true });
    const h2 = textRulesFor({ title: "액화수소 화물창 핵심기술 개발 과제 공고", region_scope: "전국" }).find((x) => x.field_key === "tech_field")!;
    expect(evaluateRule(h2, smg, TODAY).state).toBe("MET");
    const robot = textRulesFor({ title: "제조 로봇 도입 지원사업 공고", region_scope: "전국" }).find((x) => x.field_key === "tech_field")!;
    expect(robot.confidence).toBe(0.5);
    expect(evaluateRule(robot, smg, TODAY).state).toBe("UNKNOWN");
  });
});

describe("업종 분야 복수 선택", () => {
  it("여러 업종 중 하나라도 대상이면 충족", () => {
    const rule: Rule = { field_key: "industry_group", operator: "in", expected_value: JSON.stringify(["농림축수산업"]), confidence: 0.7 };
    expect(evaluateRule(rule, { industry_group: "제조업,농림축수산업" }, TODAY).state).toBe("MET");
    expect(evaluateRule(rule, { industry_group: "제조업,정보통신·SW" }, TODAY).state).toBe("NOT_MET");
  });
});
