import { describe, expect, it } from "vitest";
import { KstartupAdapter, ageRule, mapItem, regionFromSupt, ymd } from "@/collector/kstartup";
import { runSource } from "@/collector/runner";
import { normalizeAnnouncement } from "@/domain/announcements";
import { freshDb } from "./helpers";

// 공공데이터포털 15125364 응답 항목명으로 구성한 가상 항목(실제 공고 아님)
const item = (n: number, over: Record<string, unknown> = {}) => ({
  pbanc_sn: 900000 + n, biz_pbanc_nm: `가상 창업지원 ${n}`, pbanc_ntrp_nm: "가상창업센터", supt_biz_clsfc: "사업화",
  supt_regin: "경기", pbanc_rcpt_bgng_dt: "20260101", pbanc_rcpt_end_dt: "20260131", aply_trgt: "일반기업",
  biz_enyy: "예비창업자,1년미만,2년미만,3년미만", biz_trgt_age: "만 20세 이상 ~ 만 39세 이하", pbanc_ctnt: "<p>창업 사업화 지원</p>",
  detl_pg_url: `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${900000 + n}`, rcrt_prgs_yn: "Y", ...over,
});
const okFetch = (pages: unknown[][]) => {
  let i = 0;
  return (async () => new Response(JSON.stringify({ currentCount: 0, data: pages[Math.min(i++, pages.length - 1)], matchCount: 2 }))) as unknown as typeof fetch;
};

describe("K-Startup 매핑", () => {
  it("응답 항목을 표준 스키마로 변환(지역·날짜·분야·업력 규칙)", async () => {
    const m = mapItem(item(1))!;
    expect(m).toMatchObject({ sourceNoticeId: "900001", organization: "가상창업센터", regionScope: "경기도", applicationStart: "2026-01-01", applicationEnd: "2026-01-31", targetSummary: "일반기업" });
    expect(m.categories).toEqual(["startup", "commercialization"]);
    expect(m.rules).toEqual([expect.objectContaining({ fieldKey: "business_age_years", operator: "lte", expectedValue: 3, confidence: 0.6 })]);
    expect(m.eligibilityText).toContain("업력: 예비창업자");
    expect((await normalizeAnnouncement(m, "2026-01-10")).status).toBe("open");
  });
  it("모집 종료·필수 누락은 제외, 모르는 값은 추정하지 않음", () => {
    expect(mapItem(item(2, { rcrt_prgs_yn: "N" }))).toBeNull();
    expect(mapItem(item(3, { biz_pbanc_nm: "" }))).toBeNull();
    const m = mapItem(item(4, { pbanc_rcpt_end_dt: "상시", biz_enyy: "10년이상", detl_pg_url: "" }))!;
    expect(m.applicationEnd).toBeNull();
    expect(m.rules).toBeUndefined();
    expect(m.url).toContain("pbancSn=900004");
  });
  it("지역·날짜·업력 파서", () => {
    expect(regionFromSupt("전국")).toBe("전국");
    expect(regionFromSupt("서울,경기")).toBe("서울특별시·경기도");
    expect(regionFromSupt("")).toBe("전국");
    expect(ymd("20260230")).toBeNull();
    expect(ageRule("예비창업자")).toBeNull();
    expect(ageRule("1년미만,7년미만")!.expectedValue).toBe(7);
  });
  it("수집 실행: 저장·멱등·live 전환, 인증 오류 시 키 미노출", async () => {
    const db = await freshDb({ mock: false });
    expect((await db.get<any>("SELECT integration_status s FROM data_sources WHERE id='k-startup'")).s).toBe("pending_key");
    const bad = await runSource(db, new KstartupAdapter("SECRETKEY", { fetchImpl: (async () => new Response("<OpenAPI_ServiceResponse><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>")) as unknown as typeof fetch }), { retries: 0 });
    expect(bad.status).toBe("failed");
    const src = await db.get<any>("SELECT integration_status s, last_error e FROM data_sources WHERE id='k-startup'");
    expect(src.s).toBe("pending_key");
    expect(src.e).not.toContain("SECRETKEY");
    const mk = () => new KstartupAdapter("K", { fetchImpl: okFetch([[item(1), item(2, { supt_regin: "전국" })]]), sleep: async () => {} });
    expect(await runSource(db, mk())).toMatchObject({ status: "success", inserted: 2 });
    expect((await db.get<any>("SELECT integration_status s FROM data_sources WHERE id='k-startup'")).s).toBe("live");
    expect((await runSource(db, mk())).inserted).toBe(0);
    expect((await db.get<any>("SELECT COUNT(*) n FROM eligibility_rules WHERE field_key='business_age_years'")).n).toBe(2);
  });
});
