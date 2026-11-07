import { describe, expect, it } from "vitest";
import { BizinfoAdapter, BizinfoError, mapItem, parsePeriod, regionFromTags, stripHtml } from "@/collector/bizinfo";
import { runSource } from "@/collector/runner";
import { normalizeAnnouncement } from "@/domain/announcements";
import { freshDb } from "./helpers";

// 공식 문서(apiDetail)에 기재된 응답 항목명으로 구성한 가상 항목(실제 공고 아님)
const item = (n: number, over: Record<string, unknown> = {}) => ({
  pblancId: `PBLN_${n}`, pblancNm: `가상 지원사업 ${n}`, pblancUrl: `https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_${n}`,
  jrsdInsttNm: "가상기관", excInsttNm: "가상수행기관", bsnsSumryCn: "<p>사업 개요 &amp; 설명</p><br/>두번째 줄", pldirSportRealmLclasCodeNm: "금융",
  reqstBeginEndDe: "20260101 ~ 20260131", trgetNm: "중소기업", hashtags: "2026,금융,경기", creatPnttm: "2026-01-02 09:30:00",
  reqstMthPapersCn: "온라인 접수", refrncNm: "031-000-0000", rceptEngnHmpgUrl: "https://example.org/apply",
  flpthNm: "https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=F1&fileSn=0", fileNm: "공고문.pdf", totCnt: "3", ...over,
});
const okFetch = (pages: unknown[][], log: string[] = []) => {
  let i = 0;
  return (async (url: string) => { log.push(url); return new Response(JSON.stringify({ jsonArray: pages[Math.min(i++, pages.length - 1)] })); }) as unknown as typeof fetch;
};

describe("기업마당 매핑", () => {
  it("공식 응답 항목을 표준 스키마로 변환하고 검증을 통과한다", async () => {
    const m = mapItem(item(1))!;
    expect(m).toMatchObject({ sourceNoticeId: "PBLN_1", organization: "가상기관", categories: ["finance"], regionScope: "경기도", targetSummary: "중소기업", applicationStart: "2026-01-01", applicationEnd: "2026-01-31", publishedAt: "2026-01-02T00:30:00.000Z" });
    expect(m.originalText).toBe("사업 개요 & 설명\n\n두번째 줄".replace("\n\n", "\n\n"));
    expect(m.files).toEqual([{ name: "공고문.pdf", url: m.url }]);
    const n = await normalizeAnnouncement(m, "2026-01-10");
    expect(n.status).toBe("open");
    expect(n.statusBasis).toBe("estimated");
  });
  it("모르는 값은 추정하지 않는다: 날짜 형식이 아닌 신청기간·미분류 분야·필수 누락", () => {
    const m = mapItem(item(2, { reqstBeginEndDe: "예산 소진 시까지", pldirSportRealmLclasCodeNm: "경영" }))!;
    expect(m.applicationStart).toBeNull();
    expect(m.applicationEnd).toBeNull();
    expect(m.categories).toEqual([]);
    expect(m.applicationMethod).toContain("신청기간(원문 표기): 예산 소진 시까지");
    expect(mapItem(item(3, { pblancUrl: "" }))).toBeNull();
    expect(parsePeriod("20260230 ~ 20260301")).toEqual([null, null]);
    expect(parsePeriod("20260301 ~ 20260201")).toEqual([null, null]);
  });
  it("지역 태그: 없음→전국, 1개→시도, 복수→첫 지역 외 N곳, HTML 제거", () => {
    expect(regionFromTags(["금융", "2026"])).toBe("전국");
    expect(regionFromTags(["서울"])).toBe("서울특별시");
    expect(regionFromTags(["경기", "서울"])).toBe("경기도 외 1곳");
    expect(stripHtml("<script>x</script>a&lt;b")).toBe("xa<b");
  });
  it("위험 원문 URL 은 거부, 첨부는 서명 토큰 URL 을 저장하지 않고 공식 상세 링크로 연결", async () => {
    const m = mapItem(item(4, { flpthNm: "https://x/y?downloadToken=SECRETJWT@https://x/z", fileNm: "a.pdf@b.xlsx", printFileNm: "a.pdf" }))!;
    expect(m.files!.map((f) => f.name)).toEqual(["a.pdf", "b.xlsx"]);
    expect(JSON.stringify(m.files)).not.toContain("SECRETJWT");
    const bad = mapItem(item(5, { pblancUrl: "javascript:alert(1)" }))!;
    await expect(normalizeAnnouncement(bad)).rejects.toThrow();
  });
  it("실제 응답 형태(2026-11 확인, 값은 축약): 하이픈 날짜, 전 시도 태그→전국, 숫자형 totCnt, 중분류 반영", async () => {
    const real = { trgetNm: "중소기업", updtPnttm: "2026-11-06 15:16:46", hashtags: "기술,수출,서울,부산,대구,인천,전남광주,대전,울산,세종,경기,강원,충북,충남,전북,경북,경남,제주,2026", inqireCo: 2745, creatPnttm: "2026-11-06 13:20:11", pblancNm: "가상 모집 공고", pblancId: "PBLN_REAL_1", pblancUrl: "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_REAL_1", jrsdInsttNm: "가상기관", excInsttNm: "가상수행", totCnt: 1328, pldirSportRealmLclasCodeNm: "기술", pldirSportRealmMlsfcCodeNm: "기술사업화/이전/지도", reqstBeginEndDe: "2026-11-06 ~ 2026-12-09", bsnsSumryCn: "<p>개요&nbsp;문장</p><p><br></p><p style=\"line-height: 1.8;\">☞ 대상</p>", fileNm: "1.xlsx@2.hwpx", flpthNm: "https://x?downloadToken=T@https://y?downloadToken=T" };
    const m = mapItem(real)!;
    expect(m).toMatchObject({ regionScope: "전국", applicationStart: "2026-11-06", applicationEnd: "2026-12-09", categories: ["rnd", "commercialization"] });
    expect(m.originalText).toContain("개요 문장");
    expect(m.files).toHaveLength(2);
    const a = new BizinfoAdapter("K", { fetchImpl: okFetch([[real]]), sleep: async () => {} });
    expect((await a.fetch())[0].sourceNoticeId).toBe("PBLN_REAL_1");
  });
});

describe("기업마당 어댑터", () => {
  it("페이지네이션하고 요청에 키·파라미터를 싣는다", async () => {
    const log: string[] = [];
    const a = new BizinfoAdapter("KEY123", { fetchImpl: okFetch([[item(1), item(2)], [item(3)]], log), pageUnit: 2, sleep: async () => {} });
    const r = await a.fetch();
    expect(r.map((x) => x.sourceNoticeId)).toEqual(["PBLN_1", "PBLN_2", "PBLN_3"]);
    expect(log.length).toBe(2);
    expect(log[0]).toContain("crtfcKey=KEY123");
    expect(log[0]).toContain("dataType=json");
    expect(log[1]).toContain("pageIndex=2");
  });
  it("오류 메시지에 인증키가 포함되지 않는다(HTTP 오류/네트워크/비JSON/빈 응답)", async () => {
    const cases: typeof fetch[] = [
      (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
      (async () => { throw new Error("connect https://x?crtfcKey=SECRETKEY"); }) as unknown as typeof fetch,
      (async () => new Response("<xml>invalid key</xml>")) as unknown as typeof fetch,
      (async () => new Response(JSON.stringify({ reqErr: "bad" }))) as unknown as typeof fetch,
    ];
    for (const f of cases) {
      const err = await new BizinfoAdapter("SECRETKEY", { fetchImpl: f }).fetch().catch((e) => e);
      expect(err).toBeInstanceOf(BizinfoError);
      expect(String(err.message)).not.toContain("SECRETKEY");
    }
  });
  it("수집 실행: 저장·멱등·live 전환, 실패 시 pending_key 유지 및 오류 기록(키 미노출)", async () => {
    const db = await freshDb({ mock: false });
    expect((await db.get<any>("SELECT integration_status s FROM data_sources WHERE id='bizinfo'")).s).toBe("pending_key");
    const fail = await runSource(db, new BizinfoAdapter("SECRETKEY", { fetchImpl: (async () => new Response("", { status: 401 })) as unknown as typeof fetch }), { retries: 0 });
    expect(fail.status).toBe("failed");
    const src = await db.get<any>("SELECT integration_status s, last_error e FROM data_sources WHERE id='bizinfo'");
    expect(src.s).toBe("pending_key");
    expect(src.e).not.toContain("SECRETKEY");
    const mk = () => new BizinfoAdapter("K", { fetchImpl: okFetch([[item(1), item(2)]]), sleep: async () => {} });
    const r1 = await runSource(db, mk());
    expect(r1).toMatchObject({ status: "success", inserted: 2 });
    expect((await db.get<any>("SELECT integration_status s FROM data_sources WHERE id='bizinfo'")).s).toBe("live");
    const r2 = await runSource(db, mk());
    expect(r2.inserted).toBe(0);
    const row = await db.get<any>("SELECT a.region_scope, s.name FROM announcements a JOIN data_sources s ON s.id=a.source_id LIMIT 1");
    expect(row).toMatchObject({ region_scope: "경기도", name: "기업마당" });
  });
});
