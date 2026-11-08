// 규칙 기반 적합성 엔진(AI 미사용). 미입력 → UNKNOWN(확인 필요), 명백한 불일치만 NOT_MET.
import { REVENUE_BANDS, EMPLOYEE_BANDS, techFieldsIn } from "./taxonomy";
import { daysBetween } from "@/lib/time";

export type RuleState = "MET" | "NOT_MET" | "UNKNOWN";
export type Overall = "likely_met" | "needs_check" | "likely_not_met";

export interface CompanyProfile {
  region_sido?: string | null;
  region_sigungu?: string | null;
  industry_name?: string | null;
  established_at?: string | null;
  revenue_band?: string | null;
  employee_count_band?: string | null;
  research_institute_status?: string | null;
  venture_status?: string | null;
  export_status?: string | null;
  tech_keywords?: string | null;
  business_status?: string | null;
  enterprise_size?: string | null;
  certifications?: string | null;
  youth_ceo?: string | null;
  has_patent?: string | null;
  interest_categories?: string | null;
  industry_group?: string | null;
  tech_fields?: string | null;
  /** 공고ID → 조건키 → 이용자가 원문 확인한 결과 */
  checks?: Record<string, Record<string, "yes" | "no">>;
}
export interface Rule {
  field_key: string;
  operator: string;
  expected_value: string; // JSON
  source_excerpt?: string | null;
  confidence?: number;
}
export interface RuleResult {
  fieldKey: string;
  label: string;
  state: RuleState;
  reason: string;
  excerpt: string | null;
  /** UNKNOWN 사유가 '기업정보 미입력'인지 여부(입력하면 자동 판정 가능) */
  missing?: boolean;
  /** 규칙 신뢰도(0~1). 공고명·대상 문구에서 추정한 규칙은 낮음 */
  confidence?: number;
  /** 이용자가 공고 원문을 보고 직접 확인한 결과(이 공고에만 적용) */
  userChecked?: "yes" | "no";
}
export interface MatchResult {
  overall: Overall;
  score: number | null;   // 참고용 0~100
  results: RuleResult[];
  unknownCount: number;
  /** 판정 정확도(0~100): 확정 판정된 조건 비율 × 규칙 신뢰도. 규칙이 없으면 null */
  accuracy: number | null;
  /** 입력하면 자동 판정되는 미입력 기업정보 항목 라벨 */
  missingLabels: string[];
  /** 화면 표시 단계(저장 상태 overall 은 3단계 유지) */
  display: Display;
}

/**
 * 표시 단계(인계 기준 4단계 + 추정 불일치 구분)
 * - met: 적합 가능성 높음 / check: 추가 확인 필요 / insufficient: 정보 부족(확인된 조건 없음)
 * - possible_mismatch: 공고 문구에서 추정한 조건만 불일치(숨기지 않고 별도 탭)
 * - not_met: 공고에 명시된 조건(지역 등)과 입력 정보가 충돌
 */
export type Display = "met" | "check" | "insufficient" | "possible_mismatch" | "not_met";
export const DISPLAY_LABEL: Record<Display, string> = {
  met: "적합 가능성 높음", check: "추가 확인 필요", insufficient: "정보 부족", possible_mismatch: "조건 불일치 가능성", not_met: "조건 불일치 확인",
};
/** 명시 조건으로 보는 신뢰도 하한(공고 지역·DB 등록 규칙=1). 그 미만은 공고 문구 추정 */
export const EXPLICIT_CONFIDENCE = 0.9;
export function displayOf(overall: Overall, results: RuleResult[]): Display {
  if (overall === "likely_met") return "met";
  if (overall === "needs_check") return results.some((r) => r.state === "MET") ? "check" : "insufficient";
  return results.some((r) => r.state === "NOT_MET" && (r.confidence ?? 1) >= EXPLICIT_CONFIDENCE) ? "not_met" : "possible_mismatch";
}

const LABELS: Record<string, string> = {
  region_sido: "소재지(시/도)", region_sigungu: "소재지(시/군/구)", industry: "업종", business_age_years: "업력",
  revenue_band: "매출 규모", employee_band: "종업원 수", research_institute: "기업부설연구소/전담부서", venture: "벤처기업 여부",
  export: "수출 여부", tech_keywords: "기술 분야", business_status: "사업자 상태",
  enterprise_size: "기업 규모", certification: "보유 인증", industry_group: "업종 분야", tech_field: "기술 분야",
};
const YN = (v: string) => (v === "yes" ? "예" : "아니오");

function rangeIndex(list: readonly string[], v: string): number {
  return list.indexOf(v);
}

export function businessAgeYears(established: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(established)) return null;
  const d = daysBetween(established, today);
  return d < 0 ? null : d / 365.25;
}

/** 설립일 기준 n주년 날짜(윤일 보정: 2/29 → 2/28). 달력 기준으로 경계를 판정하기 위함. */
export function anniversary(established: string, years: number): string {
  const y = Number(established.slice(0, 4)) + Math.floor(years);
  const md = established.slice(5);
  const frac = years - Math.floor(years);
  let d = `${String(y).padStart(4, "0")}-${md}`;
  if (md === "02-29" && !(new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1)) d = `${y}-02-28`;
  if (frac > 0) {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + Math.round(frac * 365.25));
    d = t.toISOString().slice(0, 10);
  }
  return d;
}

/** 업종명(자유 입력)에서 업종 분야 추정. 확실한 경우만, 아니면 null */
export function inferIndustryGroup(name: string | null | undefined): string | null {
  const n = (name ?? "").replace(/\s/g, "");
  if (!n) return null;
  if (/제조|가공|생산|금속|기계|부품|화학|전자|섬유/.test(n)) return "제조업";
  if (/농업|농가|축산|어업|수산|임업|양식|원예|과수/.test(n)) return "농림축수산업";
  if (/소프트웨어|SW|정보통신|ICT|플랫폼|IT서비스|앱개발/i.test(n)) return "정보통신·SW";
  if (/숙박|호텔|펜션|음식점|외식|카페|관광|여행/.test(n)) return "관광·숙박·음식점";
  if (/건설|토목|인테리어|설비공사/.test(n)) return "건설업";
  if (/도매|소매|유통|무역|쇼핑몰|판매업/.test(n)) return "도소매·유통";
  return null;
}

function present(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export function evaluateRule(rule: Rule, c: CompanyProfile, today: string): RuleResult {
  const label = LABELS[rule.field_key] ?? rule.field_key;
  const excerpt = rule.source_excerpt ?? null;
  let expected: unknown;
  try { expected = JSON.parse(rule.expected_value); } catch { expected = rule.expected_value; }
  const confidence = Math.max(0, Math.min(1, rule.confidence ?? 1));
  const mk = (state: RuleState, reason: string, missing = false): RuleResult => ({ fieldKey: rule.field_key, label, state, reason, excerpt, confidence, ...(missing ? { missing } : {}) });
  // 인자 없이 호출 = 기업정보 미입력, 사유를 주면 = 원문/해석 문제
  const unknown = (why?: string) => (why ? mk("UNKNOWN", why) : mk("UNKNOWN", `${label} 정보가 입력되지 않아 확인이 필요합니다.`, true));

  // 낮은 신뢰도 규칙은 불일치로 확정하지 않는다
  const lowConf = (rule.confidence ?? 1) < 0.6;
  const notMet = (reason: string) => (lowConf ? mk("UNKNOWN", `${reason} (규칙 신뢰도 낮음 → 원문 확인 필요)`) : mk("NOT_MET", reason));

  switch (rule.field_key) {
    case "region_sido":
    case "region_sigungu": {
      const val = rule.field_key === "region_sido" ? c.region_sido : c.region_sigungu;
      if (!present(val)) return unknown();
      const list = (Array.isArray(expected) ? expected : [expected]).map(String);
      // 시/군/구는 입력 표기 차이('시흥' vs '시흥시')를 허용
      const sameSigungu = (a: string, b: string) => { const x = a.replace(/\s/g, ""), y = b.replace(/\s/g, ""); return x === y || x.startsWith(y) || y.startsWith(x); };
      const ok = rule.field_key === "region_sigungu" ? list.some((x) => sameSigungu(x, val)) : list.includes(val);
      return ok ? mk("MET", `${label}가 ${val}로 요건에 해당합니다.`) : notMet(`${label} ${val}은(는) 요건(${list.join(", ")})에 해당하지 않습니다.`);
    }
    case "industry": {
      if (!present(c.industry_name)) return unknown();
      const list = (Array.isArray(expected) ? expected : [expected]).map(String);
      return list.some((k) => c.industry_name!.includes(k)) ? mk("MET", `업종(${c.industry_name})이 요건과 일치합니다.`) : notMet(`업종(${c.industry_name})이 요건(${list.join(", ")})과 일치하지 않습니다.`);
    }
    case "tech_keywords": {
      if (!present(c.tech_keywords)) return unknown();
      const list = (Array.isArray(expected) ? expected : [expected]).map(String);
      return list.some((k) => c.tech_keywords!.includes(k)) ? mk("MET", "기술 분야가 요건과 일치합니다.") : mk("UNKNOWN", "입력된 기술 분야만으로는 판단할 수 없어 확인이 필요합니다.");
    }
    case "business_age_years": {
      if (!present(c.established_at)) return unknown();
      const age = businessAgeYears(c.established_at, today);
      if (age === null) return unknown("설립일 형식을 확인할 수 없습니다.");
      const n = Number(expected);
      if (!Number.isFinite(n)) return unknown("공고 요건 값을 해석할 수 없습니다.");
      // 달력 기준 판정: "3년 이내" = 설립일의 3주년 당일까지 포함
      const ann = anniversary(c.established_at, n);
      const ok = rule.operator === "gte" ? today >= ann : today <= ann;
      const txt = `업력 약 ${age.toFixed(1)}년, 요건 ${n}년 ${rule.operator === "gte" ? "이상" : "이내"}`;
      return ok ? mk("MET", txt) : notMet(txt + " → 해당하지 않음");
    }
    case "revenue_band":
    case "employee_band": {
      const list = rule.field_key === "revenue_band" ? REVENUE_BANDS : EMPLOYEE_BANDS;
      const val = rule.field_key === "revenue_band" ? c.revenue_band : c.employee_count_band;
      if (!present(val)) return unknown();
      const allowed = (Array.isArray(expected) ? expected : [expected]).map(String);
      if (allowed.includes(val)) return mk("MET", `${label} 구간(${val})이 요건에 해당합니다.`);
      if (rangeIndex(list, val) < 0) return unknown(`${label} 구간 값을 해석할 수 없습니다.`);
      return notMet(`${label} 구간(${val})이 요건(${allowed.join(", ")})에 해당하지 않습니다.`);
    }
    case "research_institute":
    case "venture":
    case "export": {
      const val = rule.field_key === "research_institute" ? c.research_institute_status : rule.field_key === "venture" ? c.venture_status : c.export_status;
      if (!present(val)) return unknown();
      return val === expected ? mk("MET", `${label}: ${YN(val)} (요건 ${YN(String(expected))})`) : notMet(`${label}: ${YN(val)} (요건 ${YN(String(expected))})`);
    }
    case "industry_group": {
      const gs = present(c.industry_group) ? c.industry_group.split(",") : [inferIndustryGroup(c.industry_name)].filter((x): x is string => !!x);
      if (!gs.length) return unknown();
      const allowed = (Array.isArray(expected) ? expected : [expected]).map(String);
      const src = present(c.industry_group) ? "" : " (업종명에서 추정)";
      const g = gs.find((x) => allowed.includes(x)) ?? gs.join(", ");
      const ok = gs.some((x) => allowed.includes(x));
      // 업종 분야를 직접 고르지 않고 업종명에서 추정한 경우: 불일치로 판정하지 않고 '확인 필요'(직접 선택 유도)
      if (!present(c.industry_group)) return ok ? { ...mk("MET", `업종 분야(${g}${src})가 지원 대상에 해당합니다.`), confidence: Math.min(confidence, 0.5) }
        : mk("UNKNOWN", `업종명으로 추정한 분야(${g})가 지원 대상(${allowed.join(", ")})과 다를 수 있습니다. 업종 분야를 선택하면 판정합니다.`, true);
      return ok ? mk("MET", `업종 분야(${g})가 지원 대상(${allowed.join(", ")})에 해당합니다.`)
        : notMet(`업종 분야(${g})가 지원 대상(${allowed.join(", ")})에 해당하지 않습니다.`);
    }
    case "tech_field": {
      // 기업 주력 기술 분야(선택) → 없으면 보유 기술·업종명 문구에서 추정
      const own = present(c.tech_fields) ? c.tech_fields.split(",") : techFieldsIn(`${c.tech_keywords ?? ""} ${c.industry_name ?? ""}`);
      if (!own.length) return unknown();
      const need = (Array.isArray(expected) ? expected : [expected]).map(String);
      const hit = need.filter((x) => own.includes(x));
      const src = present(c.tech_fields) ? "" : " (보유 기술 문구에서 추정)";
      // 기술 분야를 직접 고르지 않고 문구에서 추정한 경우: 불일치로 판정하지 않고 '확인 필요'(직접 선택 유도)
      if (!present(c.tech_fields)) return hit.length ? { ...mk("MET", `기술 분야(${hit.join(", ")}${src})가 공고 분야와 일치합니다.`), confidence: Math.min(confidence, 0.5) }
        : mk("UNKNOWN", `보유 기술로 추정한 분야(${own.join(", ")})가 공고 분야(${need.join(", ")})와 다를 수 있습니다. 주력 기술 분야를 선택하면 판정합니다.`, true);
      return hit.length ? mk("MET", `기술 분야(${hit.join(", ")}${src})가 공고 분야와 일치합니다.`)
        : notMet(`공고 기술 분야(${need.join(", ")})가 우리 기업 분야(${own.join(", ")}${src})와 다릅니다.`);
    }
    case "enterprise_size": {
      if (!present(c.enterprise_size)) return unknown();
      const allowed = (Array.isArray(expected) ? expected : [expected]).map(String);
      return allowed.includes(c.enterprise_size) ? mk("MET", `기업 규모(${c.enterprise_size})가 지원 대상(${allowed.join(", ")})에 해당합니다.`)
        : notMet(`기업 규모(${c.enterprise_size})가 지원 대상(${allowed.join(", ")})에 해당하지 않습니다.`);
    }
    case "certification": {
      if (!present(c.certifications)) return mk("UNKNOWN", "보유 인증 정보가 입력되지 않아 확인이 필요합니다.", true);
      const have = c.certifications.split(",");
      const need = (Array.isArray(expected) ? expected : [expected]).map(String);
      return need.some((x) => have.includes(x)) ? mk("MET", `보유 인증(${need.filter((x) => have.includes(x)).join(", ")})이 요건과 일치합니다.`)
        : notMet(`요건 인증(${need.join(", ")})을 보유하지 않은 것으로 입력되었습니다.`);
    }
    case "business_status": {
      if (!present(c.business_status)) return unknown();
      return c.business_status === expected ? mk("MET", `사업자 상태 ${c.business_status}`) : notMet(`사업자 상태 ${c.business_status} (요건 ${String(expected)})`);
    }
    default:
      return unknown("자동 판정할 수 없는 조건입니다. 원문을 확인하세요.");
  }
}

/**
 * 종합 판정과 참고 점수.
 * - NOT_MET 이 하나라도 있으면 likely_not_met
 * - 없고 UNKNOWN 이 있으면 needs_check
 * - 모두 MET 이면 likely_met
 * - 규칙이 없으면 needs_check(자동 판정할 조건 없음)
 * 점수: MET 비율 기반이며 UNKNOWN 은 중립(0.5)로 취급해 미입력으로 과도하게 낮아지지 않음.
 */
export function evaluateMatch(rules: Rule[], c: CompanyProfile | null, today: string, announcementId?: string): MatchResult {
  const checks = announcementId ? c?.checks?.[announcementId] : undefined;
  const results = rules.map((r) => {
    const res = evaluateRule(r, c ?? {}, today);
    const v = checks?.[r.field_key];
    if (!v) return res;
    return { ...res, state: v === "yes" ? "MET" : "NOT_MET", confidence: 1, missing: undefined, userChecked: v,
      reason: v === "yes" ? `공고 원문 확인 결과 해당함(직접 확인)` : `공고 원문 확인 결과 해당하지 않음(직접 확인)` } as RuleResult;
  });
  const unknownCount = results.filter((r) => r.state === "UNKNOWN").length;
  const notMet = results.some((r) => r.state === "NOT_MET");
  let overall: Overall;
  if (results.length === 0) overall = "needs_check";
  else if (notMet) overall = "likely_not_met";
  else if (unknownCount > 0) overall = "needs_check";
  else overall = "likely_met";
  let score: number | null = null;
  if (results.length > 0) {
    if (notMet) score = Math.round((results.filter((r) => r.state === "MET").length / results.length) * 40);
    else score = Math.round((results.reduce((s, r) => s + (r.state === "MET" ? 1 : 0.5), 0) / results.length) * 100);
  }
  // 정확도: 확정(MET/NOT_MET)된 조건만 신뢰도만큼 반영. 미입력·원문 확인 조건은 0.
  const accuracy = results.length ? Math.round((results.reduce((s, r) => s + (r.state === "UNKNOWN" ? 0 : r.confidence ?? 1), 0) / results.length) * 100) : null;
  const missingLabels = [...new Set(results.filter((r) => r.missing).map((r) => r.label))];
  return { overall, score, results, unknownCount, accuracy, missingLabels, display: displayOf(overall, results) };
}

export const OVERALL_LABEL: Record<Overall, string> = {
  likely_met: "충족 가능성 높음",
  needs_check: "확인 필요",
  likely_not_met: "미충족 가능성 높음",
};
export const STATE_LABEL: Record<RuleState, string> = { MET: "충족", NOT_MET: "미충족", UNKNOWN: "확인 필요" };

/** 공고별로 직접 확인해 정확도를 높일 수 있는 조건(미입력 기업정보는 제외: 기업정보 입력으로 해결) */
export function checkableConditions(m: MatchResult): { fieldKey: string; label: string; excerpt: string | null; userChecked?: "yes" | "no" }[] {
  const seen = new Map<string, { fieldKey: string; label: string; excerpt: string | null; userChecked?: "yes" | "no" }>();
  for (const r of m.results) {
    if (r.missing) continue;
    if (r.userChecked || r.state === "UNKNOWN" || (r.confidence ?? 1) < 1) {
      if (!seen.has(r.fieldKey)) seen.set(r.fieldKey, { fieldKey: r.fieldKey, label: r.label, excerpt: r.excerpt, userChecked: r.userChecked });
    }
  }
  return [...seen.values()];
}
