// 기업마당(bizinfo.go.kr) 지원사업정보 API 어댑터.
// 근거: https://bizinfo.go.kr/apiDetail.do?id=bizinfoApi (요청/응답 항목 문서, 수정일 2025.10.22 기준으로 확인).
// - GET https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do, 인증키 crtfcKey(기업마당 발급, 사용신청 필요), dataType=json, pageUnit/pageIndex/searchCnt
// - JSON 최상위 구조(예: jsonArray)는 문서 예시가 비공개라 여러 형태를 허용해 파싱한다. **실제 키로 호출한 검증은 아직 없음**(첫 성공 실행 시에만 'live' 로 전환).
// - 문서에 없는 값은 추정하지 않는다(신청기간이 날짜 형식이 아니면 null → '상태 확인 필요').
import type { RawAnnouncement } from "@/domain/announcements";
import type { SourceAdapter } from "./types";
import { shortSummary } from "@/lib/format";

const ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const MAX_PAGES = 30;

type Item = Record<string, unknown>;

export class BizinfoError extends Error {}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const first = (...vals: unknown[]) => vals.map(s).find((x) => x) ?? "";

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr)>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "20220727 ~ 20220930" → [시작, 마감]. 날짜 형식이 아닌 표기는 [null, null]. */
export function parsePeriod(raw: string): [string | null, string | null] {
  const m = raw.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})\s*[~∼-]\s*(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  if (!m) return [null, null];
  const a = `${m[1]}-${m[2]}-${m[3]}`;
  const b = `${m[4]}-${m[5]}-${m[6]}`;
  const ok = (d: string) => !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  return ok(a) && ok(b) && a <= b ? [a, b] : [null, null];
}

const SIDO_TAG: Record<string, string> = {
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 대전: "대전광역시", 울산: "울산광역시", 세종: "세종특별자치시",
  경기: "경기도", 강원: "강원특별자치도", 충북: "충청북도", 충남: "충청남도", 전북: "전북특별자치도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도",
  전남광주: "전남광주", // 문서의 통합 지역 태그. 단일 시/도로 매핑할 수 없어 원문 표기를 유지
};
const MID_CATEGORY: [RegExp, string][] = [[/사업화/, "commercialization"], [/지식재산|인증/, "ip"], [/판로|마케팅/, "marketing"], [/시설|설비/, "facility"]];
const FIELD_CATEGORY: Record<string, string[]> = { 금융: ["finance"], 기술: ["rnd"], 인력: ["hr"], 수출: ["export"], 내수: ["marketing"], 창업: ["startup"] }; // 경영·기타는 대응 분야가 없어 미분류

export function regionFromTags(tags: string[]): string {
  const regions = [...new Set(tags.map((t) => SIDO_TAG[t]).filter(Boolean))];
  // 실제 응답: 전국 대상 공고는 모든 시도 태그를 나열한다(17개 중 15개 이상이면 전국으로 본다)
  if (regions.length === 0 || regions.length >= 15) return "전국";
  if (regions.length === 1) return regions[0];
  return regions.join("·"); // 복수 지역 공고: 전체 목록 보존(중점 구분). 지역 필터·적합성이 모든 지역을 고려함
}

function toIsoKst(v: string): string | null {
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapItem(it: Item): RawAnnouncement | null {
  const id = first(it.pblancId, it.seq);
  const url = first(it.pblancUrl, it.link);
  const title = first(it.pblancNm, it.title);
  const org = first(it.jrsdInsttNm, it.author);
  if (!id || !url || !title || !org) return null;
  const tags = first(it.hashtags, it.hashTags).split(",").map((t) => t.trim()).filter(Boolean);
  const field = first(it.pldirSportRealmLclasCodeNm, it.lcategory);
  const periodRaw = first(it.reqstBeginEndDe, it.reqstDt);
  const [start, end] = parsePeriod(periodRaw);
  const summary = stripHtml(first(it.bsnsSumryCn, it.description));
  const method = [
    periodRaw && !start ? `신청기간(원문 표기): ${periodRaw}` : "",
    stripHtml(first(it.reqstMthPapersCn)),
    first(it.rceptEngnHmpgUrl) ? `접수 사이트: ${first(it.rceptEngnHmpgUrl)}` : "",
  ].filter(Boolean).join("\n");
  // 첨부: 이름은 '@'로 이어져 오고 파일 URL 에는 서명 토큰(downloadToken)이 포함되어 만료될 수 있어
  // 토큰 URL 은 저장하지 않고 파일명만 보존하며 링크는 공식 공고 상세 페이지로 연결한다.
  const names = [...first(it.fileNm).split("@"), ...first(it.printFileNm).split("@")].map((n) => n.trim()).filter(Boolean);
  const files: NonNullable<RawAnnouncement["files"]> = [...new Set(names)].map((name) => ({ name, url }));
  const mid = first(it.pldirSportRealmMlsfcCodeNm);
  const categories = [...new Set([...(FIELD_CATEGORY[field] ?? []), ...MID_CATEGORY.filter(([re]) => re.test(mid)).map(([, c]) => c)])];
  return {
    sourceNoticeId: id,
    url,
    title,
    organization: org,
    categories,
    regionScope: regionFromTags(tags),
    targetSummary: first(it.trgetNm) || undefined,
    supportSummary: summary ? shortSummary(summary, 160) : undefined, // 전체 본문은 originalText 에 보존
    applicationStart: start,
    applicationEnd: end,
    applicationMethod: method || undefined,
    contactInfo: stripHtml(first(it.refrncNm)) || undefined,
    originalText: summary || undefined,
    publishedAt: toIsoKst(first(it.creatPnttm, it.pubDate)),
    files,
  };
}

function extractItems(body: unknown): Item[] {
  if (Array.isArray(body)) return body as Item[];
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["jsonArray", "items", "item", "data", "list"]) {
      const v = o[k];
      if (Array.isArray(v)) return v as Item[];
      if (v && typeof v === "object") {
        const nested = extractItems(v);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

export class BizinfoAdapter implements SourceAdapter {
  readonly sourceId = "bizinfo";
  constructor(
    private apiKey: string,
    private opts: { fetchImpl?: typeof fetch; pageUnit?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  async fetch(): Promise<RawAnnouncement[]> {
    const f = this.opts.fetchImpl ?? fetch;
    const pageUnit = this.opts.pageUnit ?? 100;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const out: RawAnnouncement[] = [];
    let total = Infinity;
    for (let page = 1; page <= MAX_PAGES && out.length < total; page++) {
      const u = new URL(ENDPOINT);
      u.searchParams.set("crtfcKey", this.apiKey);
      u.searchParams.set("dataType", "json");
      u.searchParams.set("pageUnit", String(pageUnit));
      u.searchParams.set("pageIndex", String(page));
      let res: Response;
      try {
        res = await f(u.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      } catch {
        throw new BizinfoError("기업마당 API 호출 실패(네트워크/시간 초과)"); // URL(키 포함)을 메시지에 넣지 않는다
      }
      if (!res.ok) throw new BizinfoError(`기업마당 API 오류 응답(HTTP ${res.status})`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new BizinfoError("기업마당 API 응답을 JSON 으로 해석할 수 없음(인증키 오류 또는 형식 변경 가능)");
      }
      const items = extractItems(body);
      if (items.length === 0) {
        if (page === 1) throw new BizinfoError("기업마당 API 응답에 공고 항목이 없음(인증키/응답 구조 확인 필요)");
        break;
      }
      const t = Number(first(items[0].totCnt));
      if (Number.isFinite(t) && t > 0) total = t;
      for (const it of items) {
        const m = mapItem(it);
        if (m) out.push(m);
      }
      if (items.length < pageUnit) break;
      await sleep(this.opts.delayMs ?? 300); // 과도한 요청 방지
    }
    return out;
  }
}
