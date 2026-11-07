import { CATEGORIES, SIDO, STATUS_LABEL } from "@/domain/taxonomy";
import type { SearchParams } from "@/domain/search";

/** GET 폼(JS 불필요): 조건이 URL query string 으로 유지된다. */
export function SearchForm({ p, orgs, compact }: { p: Partial<SearchParams>; orgs?: string[]; compact?: boolean }) {
  return (
    <form action="/search" method="get" role="search" aria-label="공고 검색" className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="label">검색어 (사업명·기관·기술 키워드·지원 대상)</label>
          <input id="q" name="q" defaultValue={p.q ?? ""} className="input" placeholder="예: R&D, 정책자금, 수출 바우처" maxLength={100} />
        </div>
        <div className="sm:w-56">
          <label htmlFor="region" className="label">지역</label>
          <select id="region" name="region" defaultValue={p.region ?? ""} className="input">
            <option value="">전국 / 전체</option>
            {SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="경기도 시흥시">경기도 시흥시</option>
          </select>
        </div>
        <div className="sm:self-end"><button className="btn w-full sm:w-auto">검색</button></div>
      </div>
      {!compact && (
        <details className="mt-3" open={!!(p.category?.length || p.status?.length || p.org || p.from || p.to || p.soon)}>
          <summary className="cursor-pointer text-sm font-semibold">상세 조건</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="label">분야 (복수 선택)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {CATEGORIES.map((c) => (
                  <label key={c.id} className="inline-flex items-center gap-1">
                    <input type="checkbox" name="category" value={c.id} defaultChecked={p.category?.includes(c.id)} /> {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">접수 상태</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <label key={k} className="inline-flex items-center gap-1">
                    <input type="checkbox" name="status" value={k} defaultChecked={p.status?.includes(k)} /> {v}
                  </label>
                ))}
              </div>
              <label className="mt-2 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="soon" value="1" defaultChecked={p.soon} /> 마감 임박(7일 이내)만</label>
            </fieldset>
            <div>
              <label htmlFor="org" className="label">지원기관</label>
              <input id="org" name="org" list="orgs" defaultValue={p.org ?? ""} className="input" maxLength={100} />
              <datalist id="orgs">{orgs?.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="from" className="label">접수 기간(부터)</label><input id="from" type="date" name="from" defaultValue={p.from ?? ""} className="input" /></div>
              <div><label htmlFor="to" className="label">접수 기간(까지)</label><input id="to" type="date" name="to" defaultValue={p.to ?? ""} className="input" /></div>
            </div>
            <div>
              <label htmlFor="sort" className="label">정렬</label>
              <select id="sort" name="sort" defaultValue={p.sort ?? "latest"} className="input">
                <option value="latest">최신순</option>
                <option value="deadline">마감 임박순</option>
                <option value="start">접수 시작일순</option>
                <option value="relevance">관련도순</option>
                <option value="fit">기업 적합도순 (기업정보 필요)</option>
              </select>
            </div>
          </div>
        </details>
      )}
    </form>
  );
}
