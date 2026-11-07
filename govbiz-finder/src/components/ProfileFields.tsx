"use client";
import { REVENUE_BANDS, EMPLOYEE_BANDS, SIDO } from "@/domain/taxonomy";

type V = Record<string, string | null | undefined>;
const YN = [["", "미입력(확인 필요)"], ["yes", "예"], ["no", "아니오"]];

function Sel({ id, label, v, opts }: { id: string; label: string; v?: string | null; opts: readonly (readonly [string, string])[] }) {
  return (
    <div><label htmlFor={id} className="label">{label}</label>
      <select id={id} name={id} defaultValue={v ?? ""} className="input">{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
  );
}
function Txt({ id, label, v, type = "text", max = 100 }: { id: string; label: string; v?: string | null; type?: string; max?: number }) {
  return (<div><label htmlFor={id} className="label">{label}</label><input id={id} name={id} type={type} defaultValue={v ?? ""} maxLength={max} className="input" /></div>);
}

/** 모든 항목 선택 입력. 비워두면 '확인 필요'로 처리된다. */
export function ProfileFields({ v = {} }: { v?: V }) {
  const opt = (arr: readonly string[]) => [["", "미입력(확인 필요)"], ...arr.map((s) => [s, s])] as [string, string][];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Txt id="company_name" label="기업명" v={v.company_name} />
      <Txt id="representative_name" label="대표자명" v={v.representative_name} max={50} />
      <Sel id="region_sido" label="소재지(시/도)" v={v.region_sido} opts={opt(SIDO)} />
      <Txt id="region_sigungu" label="소재지(시/군/구)" v={v.region_sigungu} max={40} />
      <Txt id="industry_name" label="업종/산업분류" v={v.industry_name} />
      <Txt id="established_at" label="설립일" type="date" v={v.established_at} max={10} />
      <Sel id="revenue_band" label="매출 규모 구간" v={v.revenue_band} opts={opt(REVENUE_BANDS)} />
      <Sel id="employee_count_band" label="종업원 수 구간" v={v.employee_count_band} opts={opt(EMPLOYEE_BANDS)} />
      <Sel id="research_institute_status" label="기업부설연구소/전담부서" v={v.research_institute_status} opts={YN as [string, string][]} />
      <Sel id="venture_status" label="벤처기업 여부" v={v.venture_status} opts={YN as [string, string][]} />
      <Sel id="export_status" label="수출 여부" v={v.export_status} opts={YN as [string, string][]} />
      <Txt id="tech_keywords" label="기술 분야/보유 기술 (쉼표 구분)" v={v.tech_keywords} max={200} />
    </div>
  );
}

export function formToProfile(f: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, val] of f.entries()) if (typeof val === "string") o[k] = val;
  return o;
}
