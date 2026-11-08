// 전국주차장정보표준데이터 OpenAPI 어댑터 (공공데이터포털 15012896).
// 근거: 포털 공개 페이지의 요청주소·출력결과 표(2026-11-08 확인). ⚠ 실호출 미검증:
//  - 응답 JSON 봉투(items 위치/형태), 페이지 크기 상한, 값 분포는 키로 실응답을 확인해야 한다.
//  - 따라서 봉투는 data.go.kr에서 흔한 두 형태(items가 배열 / items.item)를 모두 수용한다.
// 응답 키는 영문 camelCase(일부 오탈자 포함, 공식 표기 그대로) → 기존 정규화기가 받는 한글 컬럼명으로 매핑한다.
// 실호출로 확인(2026-11-08): 봉투 {header, body{items{item[]}, numOfRows, pageNo, totalCount}}, totalCount 18,994, 항목 키 34개
//  (공식 표 32개 + insttCode, insttNm — 문서의 `instt_code`와 표기 다름, 매핑 대상 아님).
import type { RawRow, SourceAdapter } from "./types";
import { normalizeServiceKey } from "./service-key";

export const STANDARD_API_URL = "https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api";
export const STANDARD_SOURCE = "DATA_GO_KR_15012896";

/** 공식 출력결과 표의 키 → 정규화기 입력(한글 컬럼) */
export const STANDARD_KEY_MAP: Record<string, string> = {
  prkplceNo: "주차장관리번호", prkplceNm: "주차장명", prkplceSe: "주차장구분", prkplceType: "주차장유형",
  rdnmadr: "소재지도로명주소", lnmadr: "소재지지번주소", prkcmprt: "주차구획수", feedingSe: "급지구분", enforceSe: "부제시행구분",
  operDay: "운영요일",
  weekdayOperOpenHhmm: "평일운영시작시각", weekdayOperColseHhmm: "평일운영종료시각",
  satOperOperOpenHhmm: "토요일운영시작시각", satOperCloseHhmm: "토요일운영종료시각",
  holidayOperOpenHhmm: "공휴일운영시작시각", holidayCloseOpenHhmm: "공휴일운영종료시각",
  parkingchrgeInfo: "요금정보", basicTime: "주차기본시간", basicCharge: "주차기본요금", addUnitTime: "추가단위시간", addUnitCharge: "추가단위요금",
  dayCmmtktAdjTime: "1일주차권요금적용시간", dayCmmtkt: "1일주차권요금", monthCmmtkt: "월정기권요금",
  metpay: "결제방법", spcmnt: "특기사항", institutionNm: "관리기관명", phoneNumber: "전화번호",
  latitude: "위도", longitude: "경도", pwdbsPpkZoneYn: "장애인전용주차구역보유여부", referenceDate: "데이터기준일자",
};

/** 연결 오류의 비민감 코드(예: ENOTFOUND, UND_ERR_CONNECT_TIMEOUT). 메시지 본문은 URL/키를 담을 수 있어 사용하지 않는다 */
const netCode = (e: unknown): string => {
  const c = (e as { cause?: { code?: unknown }; name?: unknown })?.cause?.code ?? (e as { name?: unknown })?.name;
  return typeof c === "string" && /^[A-Za-z0-9_]{1,40}$/.test(c) ? c : "UNKNOWN";
};

export class StandardApiError extends Error { constructor(readonly code: string, msg: string) { super(msg); } }

const str = (v: unknown) => (v == null ? "" : String(v));

/** API 항목 1건 → 정규화기 입력 행. 알 수 없는 키는 버린다(원문은 호출 측 raw 보존 대상이 아님: 매핑된 행이 보존됨) */
export function mapStandardItem(item: Record<string, unknown>): RawRow {
  const row: RawRow = {};
  for (const [k, ko] of Object.entries(STANDARD_KEY_MAP)) row[ko] = str(item[k]);
  return row;
}

/** JSON/XML 본문 → {items, totalCount}. 오류 응답(resultCode≠00, 게이트웨이 오류)은 코드만 담아 예외 */
export function parseStandardResponse(body: string): { items: Array<Record<string, unknown>>; totalCount: number } {
  const t = body.trim();
  if (t.startsWith("{")) {
    let j: any;
    try { j = JSON.parse(t); } catch { throw new StandardApiError("BAD_RESPONSE", "응답 파싱 실패"); }
    const gw = j.cmmMsgHeader ?? j.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (gw) throw new StandardApiError(String(gw.returnReasonCode ?? "BAD_RESPONSE"), "게이트웨이 오류 응답");
    // 실제 응답(2026-11-08 실호출 확인)은 `response` 래퍼 없이 {header, body}가 최상위. 래퍼가 있는 형태도 수용한다.
    const header = j.header ?? j.response?.header;
    const bodyObj = j.body ?? j.response?.body;
    if (!header) throw new StandardApiError("BAD_RESPONSE", "응답 봉투 형식 불명");
    const code = String(header.resultCode ?? "");
    if (code !== "00") throw new StandardApiError(code || "BAD_RESPONSE", "원천 오류 응답");
    const items = bodyObj?.items;
    const arr = Array.isArray(items) ? items : Array.isArray(items?.item) ? items.item : items?.item ? [items.item] : [];
    return { items: arr, totalCount: Number(bodyObj?.totalCount ?? arr.length) };
  }
  if (t.startsWith("<")) {
    const gw = /<returnReasonCode>(\w+)<\/returnReasonCode>/.exec(t);
    if (gw) throw new StandardApiError(gw[1], "게이트웨이 오류 응답");
    const code = /<resultCode>(\w+)<\/resultCode>/.exec(t)?.[1];
    if (code !== "00") throw new StandardApiError(code ?? "BAD_RESPONSE", "원천 오류 응답");
    const tag = (blk: string, n: string) => new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(blk)?.[1];
    const items = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => Object.fromEntries(Object.keys(STANDARD_KEY_MAP).map((k) => [k, tag(m[1], k)?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")])));
    return { items, totalCount: Number(tag(t, "totalCount") ?? items.length) };
  }
  throw new StandardApiError("BAD_RESPONSE", "알 수 없는 응답 형식");
}

export type StandardPageFetcher = (pageNo: number, numOfRows: number) => Promise<string>;

/** HTTP 클라이언트. 키는 환경변수로만 주입하고 오류·로그에 URL/키를 포함하지 않는다 */
export function standardPageFetcher(opts: { serviceKey: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): StandardPageFetcher {
  const f = opts.fetchImpl ?? fetch;
  return async (pageNo, numOfRows) => {
    const u = new URL(opts.baseUrl ?? STANDARD_API_URL);
    u.searchParams.set("serviceKey", normalizeServiceKey(opts.serviceKey));
    u.searchParams.set("pageNo", String(pageNo));
    u.searchParams.set("numOfRows", String(numOfRows));
    u.searchParams.set("type", "json");
    let res: Response;
    // URL 객체 대신 문자열로 전달: tsx 등 일부 실행 환경에서 URL 객체 전달 시 연결 실패를 확인함(2026-11-08)
    try { res = await f(u.toString(), { signal: AbortSignal.timeout(opts.timeoutMs ?? 20000) }); }
    catch (e) { throw new StandardApiError("NETWORK", `원천 연결 실패(${netCode(e)})`); } // 키·주소는 포함하지 않고 오류 코드만
    if (!res.ok) throw new StandardApiError(`HTTP_${res.status}`, "원천 HTTP 오류");
    return res.text();
  };
}

/**
 * 전체 페이지를 순차 수집하는 어댑터. 한 페이지라도 실패하면 예외 → runSync가 FAILED로 기록한다
 * (일부만 받은 상태를 '전체'로 오인하지 않도록, 이미 저장된 행은 유지하되 미수신 시설을 삭제하지 않는 기존 정책을 따른다).
 */
export class StandardApiAdapter implements SourceAdapter {
  readonly sourceName = STANDARD_SOURCE;
  constructor(private readonly fetchPage: StandardPageFetcher, private readonly pageSize = 100, private readonly maxPages = 2000) {}
  async *fetch(): AsyncIterable<RawRow> {
    let seen = 0;
    for (let page = 1; page <= this.maxPages; page++) {
      const { items, totalCount } = parseStandardResponse(await this.fetchPage(page, this.pageSize));
      for (const it of items) yield mapStandardItem(it);
      seen += items.length;
      if (items.length < this.pageSize || seen >= totalCount) return;
    }
    throw new StandardApiError("PAGE_LIMIT", "페이지 상한 초과"); // 비정상적으로 많은 페이지: 무한 루프 방지
  }
}
