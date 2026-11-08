"use client";
import { useState } from "react";
import { MultiDrop } from "./MultiDrop";
import { SIGUNGU } from "@/domain/regions";
import { REVENUE_BANDS, EMPLOYEE_BANDS, SIDO, ENTERPRISE_SIZES, CERTIFICATIONS, CATEGORIES, INDUSTRY_GROUPS, TECH_FIELDS } from "@/domain/taxonomy";

type V = Record<string, string | null | undefined>;
const YN: [string, string][] = [["", "미입력(확인 필요)"], ["yes", "예"], ["no", "아니오"]];
const opt = (arr: readonly string[]): [string, string][] => [["", "미입력(확인 필요)"], ...arr.map((s): [string, string] => [s, s])];

function Sel({ id, label, v, opts, hint }: { id: string; label: string; v?: string | null; opts: [string, string][]; hint?: string }) {
  return (
    <div><label htmlFor={id} className="label">{label}</label>
      <select id={id} name={id} defaultValue={v ?? ""} className="input">{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}</div>
  );
}
function Txt({ id, label, v, type = "text", max = 100, placeholder, hint }: { id: string; label: string; v?: string | null; type?: string; max?: number; placeholder?: string; hint?: string }) {
  return (<div><label htmlFor={id} className="label">{label}</label><input id={id} name={id} type={type} defaultValue={v ?? ""} maxLength={max} placeholder={placeholder} className="input" />
    {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}</div>);
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (<fieldset className="rounded-lg border border-[var(--line)] p-4"><legend className="px-1 text-sm font-bold">{title}</legend><div className="grid gap-4 sm:grid-cols-2">{children}</div></fieldset>);
}

/** 시/도 선택에 따라 시/군/구 목록이 바뀌는 연동 드롭다운. 기존 자유 입력값은 목록에 없어도 유지 */
function RegionSelect({ sido, sigungu }: { sido?: string | null; sigungu?: string | null }) {
  const [sd, setSd] = useState(sido ?? "");
  const [sg, setSg] = useState(sigungu ?? "");
  const list = SIGUNGU[sd] ?? [];
  const extra = sg && !list.includes(sg) ? [sg] : [];
  return (
    <>
      <div><label htmlFor="region_sido" className="label">소재지(시/도)</label>
        <select id="region_sido" name="region_sido" value={sd} className="input" onChange={(e) => { setSd(e.target.value); setSg(""); }}>
          <option value="">미입력(확인 필요)</option>{SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--muted)]">지역 한정 공고 판정에 가장 중요합니다.</p></div>
      <div><label htmlFor="region_sigungu" className="label">소재지(시/군/구)</label>
        <select id="region_sigungu" name="region_sigungu" value={sg} className="input" disabled={!sd} onChange={(e) => setSg(e.target.value)}>
          <option value="">{sd ? "미입력(확인 필요)" : "시/도를 먼저 선택"}</option>
          {[...extra, ...list].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--muted)]">시·군 단위 공고(예: [경기] 안성시) 판정에 사용</p></div>
    </>
  );
}

/** 모든 항목 선택 입력. 비워두면 '확인 필요'로 처리되며 불이익은 없다. */
export function ProfileFields({ v = {} }: { v?: V }) {
  return (
    <div className="grid gap-4">
      <Group title="기본 정보">
        <Txt id="company_name" label="기업명" v={v.company_name} />
        <Txt id="representative_name" label="대표자명" v={v.representative_name} max={50} />
        <RegionSelect sido={v.region_sido} sigungu={v.region_sigungu} />
        <MultiDrop name="industry_group" label="업종 분야(복수 선택)" items={INDUSTRY_GROUPS.map((c) => [c, c] as const)} v={v.industry_group} hint="농가·관광업체 등 업종 한정 공고를 걸러냅니다." />
        <Txt id="industry_name" label="업종/주요 제품(선택, 상세)" v={v.industry_name} placeholder="예: 금속가공 제조업" />
        <Txt id="established_at" label="설립일" type="date" v={v.established_at} max={10} hint="업력(창업 N년 이내 등) 판정에 사용" />
      </Group>
      <Group title="규모·실적">
        <Sel id="enterprise_size" label="기업 규모" v={v.enterprise_size} opts={opt(ENTERPRISE_SIZES)} />
        <Sel id="revenue_band" label="매출 규모 구간" v={v.revenue_band} opts={opt(REVENUE_BANDS)} />
        <Sel id="employee_count_band" label="종업원 수 구간" v={v.employee_count_band} opts={opt(EMPLOYEE_BANDS)} />
        <Sel id="export_status" label="수출 실적" v={v.export_status} opts={YN} />
      </Group>
      <Group title="인증·역량">
        <Sel id="research_institute_status" label="기업부설연구소/전담부서" v={v.research_institute_status} opts={YN} />
        <Sel id="venture_status" label="벤처기업 확인" v={v.venture_status} opts={YN} />
        <Sel id="has_patent" label="특허 보유" v={v.has_patent} opts={YN} />
        <Sel id="youth_ceo" label="청년 대표자(만 39세 이하)" v={v.youth_ceo} opts={YN} hint="생년월일은 받지 않습니다." />
        <MultiDrop name="certifications" label="보유 인증(복수 선택)" items={CERTIFICATIONS.map((c) => [c, c] as const)} v={v.certifications} />
        <MultiDrop name="tech_fields" label="주력 기술 분야(복수 선택)" items={TECH_FIELDS.map((c) => [c, c] as const)} v={v.tech_fields} hint="6G·반도체 등 특정 기술 분야 공고 중 우리와 다른 분야를 걸러냅니다. 비우면 아래 보유 기술 문구로 추정합니다." />
        <Txt id="tech_keywords" label="보유 기술 키워드(선택, 상세·쉼표 구분)" v={v.tech_keywords} max={200} placeholder="예: 극저온, 수소, 스마트공장" />
      </Group>
      <Group title="관심 분야">
        <MultiDrop name="interest_categories" label="관심 있는 지원 분야(복수 선택)" items={CATEGORIES.map((c) => [c.id, c.name] as const)} v={v.interest_categories} hint="추천 순서에서 관심 분야 공고를 앞에 보여 줍니다(다른 공고를 숨기지 않음)." />
      </Group>
    </div>
  );
}

const MULTI = ["certifications", "interest_categories", "tech_fields", "industry_group"];
export function formToProfile(f: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, val] of f.entries()) {
    if (typeof val !== "string") continue;
    if (MULTI.includes(k)) o[k] = o[k] ? `${o[k]},${val}` : val;
    else o[k] = val;
  }
  for (const k of MULTI) if (!(k in o)) o[k] = "";
  return o;
}

