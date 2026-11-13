"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { CATEGORIES } from "@/domain/taxonomy";
import { formatSeoul } from "@/lib/time";

type Any = Record<string, any>;

export function AdminPanel() {
  const [ov, setOv] = useState<Any>({ sources: [], runs: [] });
  const [claims, setClaims] = useState<Any[]>([]);
  const [anns, setAnns] = useState<Any[]>([]);
  const [dups, setDups] = useState<Any[]>([]);
  const [audit, setAudit] = useState<Any[]>([]);
  const [subs, setSubs] = useState<{ items: Any[]; enabled: boolean }>({ items: [], enabled: false });
  const [reqs, setReqs] = useState<Any[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [a, b, c, d, e] = await Promise.all([api<Any>("GET", "/api/admin/overview"), api<Any>("GET", "/api/admin/claims"), api<Any>("GET", "/api/admin/announcements"), api<Any>("GET", "/api/admin/duplicates"), api<Any>("GET", "/api/admin/audit")]);
    const sb = await api<Any>("GET", "/api/admin/subscriptions");
    if (sb.ok) setSubs(sb.data as { items: Any[]; enabled: boolean });
    const pr = await api<Any>("GET", "/api/admin/plan-requests");
    if (pr.ok) setReqs(pr.data.items);
    if (a.ok) setOv(a.data); if (b.ok) setClaims(b.data.items); if (c.ok) setAnns(c.data.items); if (d.ok) setDups(d.data.items); if (e.ok) setAudit(e.data.items);
  }, []);
  // 외부(API) 데이터 동기화를 위한 최초 로드
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function act(p: Promise<{ ok: boolean; data: Any }>, ok = "처리했습니다.") {
    const r = await p;
    setMsg(r.ok ? ok : r.data.message ?? "실패했습니다.");
    load();
  }
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Any = Object.fromEntries([...f.entries()].filter(([k, v]) => k !== "categories" && typeof v === "string" && v !== ""));
    body.categories = f.getAll("categories");
    const form = e.currentTarget;
    const r = await api<Any>("POST", "/api/admin/announcements", body);
    setMsg(r.ok ? "등록했습니다." : r.data.message ?? "등록하지 못했습니다.");
    if (r.ok) { form.reset(); load(); }
  }
  return (
    <div className="grid gap-8">
      <p role="status" className="text-sm text-[var(--muted)]">{msg}</p>

      <section aria-labelledby="src"><h2 id="src" className="mb-2 text-lg font-bold">수집 원천·모니터링</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b"><th>원천</th><th>연동</th><th>활성</th><th>마지막 성공</th><th>마지막 오류</th><th>비고</th><th></th></tr></thead>
          <tbody>{ov.sources.map((s: Any) => (<tr key={s.id} className="border-b align-top">
            <td className="py-1 pr-2">{s.name}</td><td>{({ not_integrated: "미연동", pending_key: "키 대기", mock: "테스트", manual: "수동", live: "연동" } as Any)[s.integration_status]}</td>
            <td>{s.enabled ? "ON" : "OFF"}</td><td>{formatSeoul(s.last_success_at)}</td><td className="max-w-[200px] break-words text-red-700">{s.last_error ?? "-"}</td><td className="max-w-[240px] text-xs text-[var(--muted)]">{s.quota_note}</td>
            <td className="space-x-1 whitespace-nowrap">
              <button className="btn btn-ghost" disabled={s.integration_status === "not_integrated"} onClick={() => act(api("PUT", `/api/admin/sources/${s.id}`, { enabled: !s.enabled }))}>{s.enabled ? "비활성화" : "활성화"}</button>
              {(s.id === "mock" || s.id === "bizinfo") && <button className="btn btn-ghost" onClick={() => act(api("POST", "/api/admin/collect", { sourceId: s.id }), "수집을 실행했습니다.")}>수집 실행</button>}
            </td></tr>))}</tbody></table></div>
        <h3 className="mt-4 font-semibold">최근 수집 실행</h3>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b"><th>시작</th><th>원천</th><th>상태</th><th>수집/신규/갱신/건너뜀</th><th>오류</th></tr></thead>
          <tbody>{ov.runs.map((r: Any) => (<tr key={r.id} className="border-b"><td>{formatSeoul(r.started_at)}</td><td>{r.source_id}</td><td>{r.status}</td><td>{r.fetched_count}/{r.inserted_count}/{r.updated_count}/{r.skipped_count}</td><td className="max-w-[260px] break-words">{r.error_summary ?? "-"}</td></tr>))}</tbody></table></div>
      </section>

      <section aria-labelledby="cl"><h2 id="cl" className="mb-2 text-lg font-bold">기업 관계 확인 신청</h2>
        <p className="mb-2 text-sm text-[var(--muted)]">사업자등록증 등 증빙은 시스템 외부에서 확인 후 승인하세요. 동일 기업에 복수 신청(충돌)이 있으면 ‘신청 수’가 2 이상으로 표시됩니다.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b"><th>신청자</th><th>사업자번호</th><th>상태</th><th>신청 수</th><th></th></tr></thead>
          <tbody>{claims.map((c) => (<tr key={c.user_id + c.company_id} className="border-b"><td>{c.email}</td><td>{c.business_number_masked}</td><td>{c.verification_status}</td><td>{c.claim_count}{c.claim_count > 1 ? " ⚠" : ""}</td>
            <td className="space-x-1">{c.verification_status === "pending" && <>
              <button className="btn" onClick={() => act(api("POST", "/api/admin/claims", { userId: c.user_id, companyId: c.company_id, decision: "approve" }))}>승인</button>
              <button className="btn btn-danger" onClick={() => act(api("POST", "/api/admin/claims", { userId: c.user_id, companyId: c.company_id, decision: "reject" }))}>반려</button></>}</td></tr>))}</tbody></table></div>
      </section>

      <section aria-labelledby="an"><h2 id="an" className="mb-2 text-lg font-bold">공고 관리</h2>
        <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-2" aria-label="공고 수동 등록">
          <div className="sm:col-span-2 font-semibold">공고 수동 등록</div>
          <div><label className="label" htmlFor="t">사업명*</label><input id="t" name="title" required className="input" /></div>
          <div><label className="label" htmlFor="o">지원기관*</label><input id="o" name="organization" required className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="u">공식 원문 URL* (http/https)</label><input id="u" name="url" required type="url" className="input" /></div>
          <div><label className="label" htmlFor="r">지역</label><input id="r" name="regionScope" placeholder="전국 / 경기도 / 경기도 시흥시" className="input" /></div>
          <div><label className="label" htmlFor="ta">지원 대상</label><input id="ta" name="targetSummary" className="input" /></div>
          <div><label className="label" htmlFor="s1">접수 시작일</label><input id="s1" type="date" name="applicationStart" className="input" /></div>
          <div><label className="label" htmlFor="s2">접수 마감일</label><input id="s2" type="date" name="applicationEnd" className="input" /></div>
          <div><label className="label" htmlFor="cs">원문 확인 상태(선택)</label><select id="cs" name="confirmedStatus" className="input"><option value="">날짜로 추정</option><option value="upcoming">접수 예정</option><option value="open">접수 중</option><option value="closed">마감</option><option value="always">상시 접수</option></select></div>
          <div><label className="label" htmlFor="am">지원내용</label><input id="am" name="supportSummary" className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="el">신청 자격</label><textarea id="el" name="eligibilityText" rows={2} className="input" /></div>
          <fieldset className="sm:col-span-2"><legend className="label">분야</legend><div className="flex flex-wrap gap-3 text-sm">{CATEGORIES.map((c) => <label key={c.id}><input type="checkbox" name="categories" value={c.id} /> {c.name}</label>)}</div></fieldset>
          <div className="sm:col-span-2"><button className="btn">등록</button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b"><th>사업명</th><th>기관</th><th>상태</th><th>원천</th><th>활성</th><th></th></tr></thead>
          <tbody>{anns.map((a) => (<tr key={a.id} className="border-b"><td className="py-1 pr-2">{a.title}</td><td>{a.organization}</td><td>{a.application_status}</td><td>{a.source_id}</td><td>{a.is_active ? "활성" : "비활성"}</td>
            <td><button className="btn btn-ghost" onClick={() => act(api("PUT", `/api/admin/announcements/${a.id}`, { isActive: !a.is_active }))}>{a.is_active ? "비활성화" : "활성화"}</button></td></tr>))}</tbody></table></div>
      </section>

      <section aria-labelledby="pr"><h2 id="pr" className="mb-2 text-lg font-bold">이용 신청(입금 확인) <span className="text-sm font-normal text-[var(--muted)]">대기 {reqs.filter((r) => r.status === "pending").length}건</span></h2>
        <p className="mb-2 text-xs text-[var(--muted)]">통장에서 입금자명·금액을 확인한 뒤 [입금 확인]을 누르면 요금제와 이용 종료일이 자동 설정됩니다(같은 요금제가 유효하면 이어서 연장). 세금계산서는 별도 발행 후 메모에 기록하세요.</p>
        {reqs.length === 0 ? <p className="text-sm text-[var(--muted)]">신청이 없습니다.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left"><th>신청일</th><th>기업</th><th>내용</th><th>입금액</th><th>입금자명</th><th>세금계산서</th><th>상태</th><th>메모</th><th></th></tr></thead>
          <tbody>{reqs.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td>{formatSeoul(r.created_at)}</td>
              <td>{r.company_name ?? "(이름 없음)"}<br /><span className="text-xs text-[var(--muted)]">{r.business_number_masked} · {r.email ?? "-"}</span></td>
              <td>{r.plan === "team" ? "Team" : "Pro"} · {r.cycle === "yearly" ? "연" : "월"} · {r.seats}명{r.memo && <><br /><span className="text-xs text-[var(--muted)]">{r.memo}</span></>}</td>
              <td><strong>{Number(r.amount_total).toLocaleString()}원</strong><br /><span className="text-xs text-[var(--muted)]">공급가 {Number(r.amount_supply).toLocaleString()}</span></td>
              <td className="whitespace-nowrap">{r.depositor_name}</td><td>{r.invoice_email}</td>
              <td className="whitespace-nowrap">{({ pending: "대기", approved: "승인", rejected: "반려", cancelled: "취소" } as Any)[r.status]}</td>
              <td>{r.status === "pending" ? <input id={`pm-${r.id}`} maxLength={500} className="input !py-1" placeholder="반려 사유·입금일" /> : <span className="text-xs">{r.admin_memo ?? ""}</span>}</td>
              <td className="whitespace-nowrap">{r.status === "pending" && <>
                <button className="btn" onClick={() => { if (confirm(`${Number(r.amount_total).toLocaleString()}원 입금을 확인했습니까?`)) act(api("POST", "/api/admin/plan-requests", { requestId: r.id, decision: "approve", adminMemo: (document.getElementById(`pm-${r.id}`) as HTMLInputElement).value }), "입금 확인 처리했습니다."); }}>입금 확인</button>{" "}
                <button className="btn btn-ghost" onClick={() => { if (confirm("반려할까요?")) act(api("POST", "/api/admin/plan-requests", { requestId: r.id, decision: "reject", adminMemo: (document.getElementById(`pm-${r.id}`) as HTMLInputElement).value }), "반려했습니다."); }}>반려</button></>}</td>
            </tr>))}</tbody></table></div>)}
      </section>

      <section aria-labelledby="sb"><h2 id="sb" className="mb-2 text-lg font-bold">요금제 관리 <span className="text-sm font-normal text-[var(--muted)]">{subs.enabled ? "한도 적용 중(PLANS_ENABLED=true)" : "한도 미적용(판매 전) — 설정만 저장됨"}</span></h2>
        <p className="mb-2 text-xs text-[var(--muted)]">입금 확인 후 요금제·이용 종료일을 저장합니다. 체험은 체험 종료일만 넣습니다. 종료일이 지나면 자동으로 무료 한도가 적용되고 데이터는 유지됩니다.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>기업</th><th>구성원</th><th>요금제</th><th>인원</th><th>체험 종료</th><th>이용 종료</th><th>메모</th><th></th></tr></thead>
          <tbody>{subs.items.map((r) => (
            <tr key={r.company_id} className="border-b align-top">
              <td>{r.company_name ?? "(이름 없음)"}<br /><span className="text-xs text-[var(--muted)]">{r.business_number_masked}</span></td>
              <td>{r.members}{r.seats && r.members > r.seats ? " ⚠" : ""}</td>
              <td><select id={`sp-${r.company_id}`} defaultValue={r.plan ?? "free"} className="input !w-auto !py-1"><option value="free">무료</option><option value="pro">Pro</option><option value="team">Team</option></select></td>
              <td><input id={`ss-${r.company_id}`} type="number" min={1} max={100} defaultValue={r.seats ?? 1} className="input !w-20 !py-1" /></td>
              <td><input id={`st-${r.company_id}`} type="date" defaultValue={r.trial_ends_at ?? ""} className="input !w-auto !py-1" /></td>
              <td><input id={`su-${r.company_id}`} type="date" defaultValue={r.paid_until ?? ""} className="input !w-auto !py-1" /></td>
              <td><input id={`sm-${r.company_id}`} defaultValue={r.memo ?? ""} maxLength={500} className="input !py-1" placeholder="입금일·세금계산서" /></td>
              <td><button className="btn" onClick={() => { const g = (k: string) => (document.getElementById(`${k}-${r.company_id}`) as HTMLInputElement).value; act(api("PUT", "/api/admin/subscriptions", { companyId: r.company_id, plan: g("sp"), seats: g("ss"), trialEndsAt: g("st"), paidUntil: g("su"), memo: g("sm") })); }}>저장</button></td>
            </tr>))}</tbody></table></div>
      </section>
      <section aria-labelledby="du"><h2 id="du" className="mb-2 text-lg font-bold">중복 공고 검토</h2>
        {dups.length === 0 ? <p className="text-sm text-[var(--muted)]">복수 원천으로 병합된 공고가 없습니다.</p> : <ul className="list-disc pl-5 text-sm">{dups.map((d) => <li key={d.id}>{d.title} ({d.source_count}개 출처)</li>)}</ul>}
      </section>

      <section aria-labelledby="au"><h2 id="au" className="mb-2 text-lg font-bold">감사 로그</h2>
        <ul className="text-sm">{audit.map((a) => <li key={a.id} className="border-b py-1">{formatSeoul(a.created_at)} · {a.action} · {a.target_type ?? ""} {a.target_id ?? ""}</li>)}</ul>
      </section>
    </div>
  );
}
