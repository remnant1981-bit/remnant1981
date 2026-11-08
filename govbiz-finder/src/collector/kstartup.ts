// K-Startup(창업진흥원) 사업공고 API 어댑터 — 공공데이터포털 15125364 '창업진흥원_K-Startup 조회서비스'
// - GET https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01
//   ServiceKey(공공데이터포털 발급), page, perPage(최대 100), returnType=json, rcrt_prgs_yn=Y(모집 진행 중)
// - 이용조건: 무료, 이용허락범위 제한 없음(포털 표기, 2026-11 확인). 출처 'K-Startup' 및 공식 상세 링크 표시.
// - 응답: { data: [...] } (odcloud 형식). 다른 형태(response.body.items)도 허용. 실호출 검증 전이므로 첫 성공 시에만 live 전환.
import type { RawAnnouncement, RuleInput } from "@/domain/announcements";
import type { SourceAdapter } from "./types";
import { shortSummary } from "@/lib/format";
import { stripHtml } from "./bizinfo";

const ENDPOINT = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";
const MAX_PAGES = 20;
type Item = Record<string, unknown>;

export class KstartupError extends Error {}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const first = (...vals: unknown[]) => vals.map(s).find((x) => x) ?? "";

const SIDO_SHORT: Record<string, string> = {
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 광주: "광주광역시", 대전: "대전광역시", 울산: "울산광역시", 세종: "세종특별자치시",
  경기: "경기도", 강원: "강원특별자치도", 충북: "충청북도", 충남: "충청남도", 전북: "전북특별자치도", 전남: "전라남도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도",
};

/** "서울,경기" / "전국" → 지역 표기. 14곳 이상 나열되면 전국으로 본다 */
export function regionFromSupt(raw: string): string {
  const toks = raw.split(/[,\s/·]+/).map((t) => t.trim()).filter(Boolean);
  if (!toks.length || toks.includes("전국")) return "전국";
  const sidos = [...new Set(toks.map((t) => SIDO_SHORT[t] ?? SIDO_SHORT[t.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, "")] ?? ""))].filter(Boolean);
  if (!sidos.length || sidos.length >= 14) return "전국";
  return sidos.join("·");
}

/** YYYYMMDD → YYYY-MM-DD (유효하지 않으면 null) */
export function ymd(raw: string): string | null {
  const m = raw.replace(/[^0-9]/g, "").match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  const t = new Date(d + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d ? d : null;
}

const CLSFC: [RegExp, string][] = [
  [/사업화/, "commercialization"], [/R&D|기술개발|연구/, "rnd"], [/시설|공간|보육/, "facility"], [/융자|보증|자금|투자/, "finance"],
  [/인력/, "hr"], [/글로벌|해외/, "export"], [/판로|마케팅/, "marketing"],
];

/** 업력 대상("예비창업자,1년미만,3년미만,7년미만") → 업력 상한 규칙. '10년이상' 등 상한이 없으면 규칙 없음 */
export function ageRule(raw: string): RuleInput | null {
  const t = raw.replace(/\s/g, "");
  if (!t || /이상|제한없음|무관/.test(t)) return null;
  const ns = [...t.matchAll(/(\d{1,2})년(미만|이내|이하)/g)].map((m) => Number(m[1]));
  if (!ns.length) return null;
  return { fieldKey: "business_age_years", operator: "lte", expectedValue: Math.max(...ns), sourceExcerpt: `업력 대상: ${raw}`, confidence: 0.6 };
}

export function mapItem(it: Item): RawAnnouncement | null {
  const id = first(it.pbanc_sn, it.pbancSn);
  const title = first(it.biz_pbanc_nm, it.intg_pbanc_biz_nm);
  if (!id || !title) return null;
  if (first(it.rcrt_prgs_yn) === "N") return null; // 모집 종료 공고는 제외
  const url = first(it.detl_pg_url) || `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${encodeURIComponent(id)}`;
  const org = first(it.pbanc_ntrp_nm, it.sprv_inst, it.biz_prch_dprt_nm) || "창업진흥원(K-Startup)";
  const content = stripHtml(first(it.pbanc_ctnt));
  const clsfc = first(it.supt_biz_clsfc);
  const categories = [...new Set(["startup", ...CLSFC.filter(([re]) => re.test(clsfc)).map(([, c]) => c)])];
  const enyy = first(it.biz_enyy);
  const elig = [
    first(it.aply_trgt) && `신청 대상: ${first(it.aply_trgt)}`,
    enyy && `업력: ${enyy}`,
    first(it.biz_trgt_age) && `대상 연령: ${first(it.biz_trgt_age)}`,
    stripHtml(first(it.aply_trgt_ctnt)),
    first(it.aply_excl_trgt_ctnt) && `신청 제외 대상: ${stripHtml(first(it.aply_excl_trgt_ctnt))}`,
  ].filter(Boolean).join("\n");
  const rule = ageRule(enyy);
  const aplyUrl = first(it.biz_aply_url);
  return {
    sourceNoticeId: id,
    url,
    title,
    organization: org,
    categories,
    regionScope: regionFromSupt(first(it.supt_regin)),
    targetSummary: first(it.aply_trgt) || undefined,
    supportSummary: content ? shortSummary(content, 160) : clsfc || undefined,
    applicationStart: ymd(first(it.pbanc_rcpt_bgng_dt)),
    applicationEnd: ymd(first(it.pbanc_rcpt_end_dt)),
    eligibilityText: elig || undefined,
    applicationMethod: aplyUrl ? `신청 사이트: ${aplyUrl}` : undefined,
    contactInfo: first(it.prch_cnpl_no) || undefined,
    originalText: content || undefined,
    rules: rule ? [rule] : undefined,
  };
}

function extractItems(body: unknown): Item[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data as Item[];
  const items = (o.response as { body?: { items?: unknown } } | undefined)?.body?.items;
  if (Array.isArray(items)) return items as Item[];
  if (items && typeof items === "object" && Array.isArray((items as { item?: unknown }).item)) return (items as { item: Item[] }).item;
  return [];
}

export class KstartupAdapter implements SourceAdapter {
  readonly sourceId = "k-startup";
  constructor(private apiKey: string, private opts: { fetchImpl?: typeof fetch; perPage?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {}

  async fetch(): Promise<RawAnnouncement[]> {
    const f = this.opts.fetchImpl ?? fetch;
    const perPage = this.opts.perPage ?? 100;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const out: RawAnnouncement[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const u = new URL(ENDPOINT);
      u.searchParams.set("serviceKey", this.apiKey);
      u.searchParams.set("page", String(page));
      u.searchParams.set("perPage", String(perPage));
      u.searchParams.set("returnType", "json");
      u.searchParams.set("rcrt_prgs_yn", "Y");
      let res: Response;
      try {
        res = await f(u.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      } catch {
        throw new KstartupError("K-Startup API 호출 실패(네트워크/시간 초과)"); // 키가 들어간 URL 은 메시지에 넣지 않는다
      }
      const text = await res.text();
      if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED|LIMITED_NUMBER_OF_SERVICE_REQUESTS|<errMsg>/i.test(text))
        throw new KstartupError("K-Startup API 인증/쿼터 오류(공공데이터포털 활용신청·키 확인 필요)");
      if (!res.ok) throw new KstartupError(`K-Startup API 오류 응답(HTTP ${res.status})`);
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new KstartupError("K-Startup API 응답을 JSON 으로 해석할 수 없음"); }
      const items = extractItems(body);
      if (!items.length) {
        if (page === 1) throw new KstartupError("K-Startup API 응답에 공고 항목이 없음(키/응답 구조 확인 필요)");
        break;
      }
      for (const it of items) { const m = mapItem(it); if (m) out.push(m); }
      const total = Number((body as { totalCount?: unknown; matchCount?: unknown }).matchCount ?? (body as { totalCount?: unknown }).totalCount);
      if (items.length < perPage || (Number.isFinite(total) && page * perPage >= total)) break;
      await sleep(this.opts.delayMs ?? 300);
    }
    return out;
  }
}
