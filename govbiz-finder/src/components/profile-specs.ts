// 판정 규칙 항목(fieldKey) → 기업정보 입력 필드 정의. 맞춤 정확도 높이기·카드 내 바로 입력에서 공용.
import { REVENUE_BANDS, EMPLOYEE_BANDS, SIDO, ENTERPRISE_SIZES, CERTIFICATIONS, INDUSTRY_GROUPS, TECH_FIELDS } from "@/domain/taxonomy";

export type Spec =
  | { key: string; kind: "select"; opts: [string, string][] }
  | { key: string; kind: "text"; placeholder?: string }
  | { key: string; kind: "date" }
  | { key: string; kind: "sigungu" }
  | { key: string; kind: "checks"; items: readonly string[] };

const YN: [string, string][] = [["yes", "예"], ["no", "아니오"]];
const opts = (a: readonly string[]): [string, string][] => a.map((x) => [x, x]);

/** 판정 규칙 항목 → 입력 필드. 사업자 상태는 국세청 조회로만 채우므로 제외 */
export const SPECS: Record<string, Spec> = {
  region_sido: { key: "region_sido", kind: "select", opts: opts(SIDO) },
  region_sigungu: { key: "region_sigungu", kind: "sigungu" },
  industry_group: { key: "industry_group", kind: "checks", items: INDUSTRY_GROUPS },
  industry: { key: "industry_name", kind: "text", placeholder: "예: 금속가공 제조업" },
  business_age_years: { key: "established_at", kind: "date" },
  enterprise_size: { key: "enterprise_size", kind: "select", opts: opts(ENTERPRISE_SIZES) },
  revenue_band: { key: "revenue_band", kind: "select", opts: opts(REVENUE_BANDS) },
  employee_band: { key: "employee_count_band", kind: "select", opts: opts(EMPLOYEE_BANDS) },
  research_institute: { key: "research_institute_status", kind: "select", opts: YN },
  venture: { key: "venture_status", kind: "select", opts: YN },
  export: { key: "export_status", kind: "select", opts: YN },
  certification: { key: "certifications", kind: "checks", items: CERTIFICATIONS },
  tech_field: { key: "tech_fields", kind: "checks", items: TECH_FIELDS },
  tech_keywords: { key: "tech_keywords", kind: "text", placeholder: "예: 수소, 극저온" },
};


export { SIGUNGU } from "@/domain/regions";
