"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { ProfileFields, formToProfile } from "./ProfileFields";
import { Notice } from "./ui";

type Company = Record<string, string | null> & { id: string };

export function CompanyPanel({ membership, company }: { membership: string; company: Company | null }) {
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [nts, setNts] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(membership);

  async function claim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const f = new FormData(e.currentTarget);
    const r = await api<any>("POST", "/api/company/claim", { bizNo: f.get("bizNo") });
    setBusy(false);
    if (r.ok) { setState(r.data.status); if (r.data.status === "verified") window.location.reload(); }
    else setMsg({ tone: "error", text: r.data.message ?? "신청하지 못했습니다." });
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await api<any>("PUT", "/api/company", formToProfile(new FormData(e.currentTarget)));
    setBusy(false);
    setMsg(r.ok ? { tone: "info", text: "저장했습니다. 비워둔 항목은 ‘확인 필요’로 처리됩니다." } : { tone: "error", text: r.data.message ?? "저장하지 못했습니다." });
  }
  async function lookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null); setNts(null);
    const f = new FormData(e.currentTarget);
    const r = await api<any>("POST", "/api/company/nts", { bizNo: f.get("bizNo") });
    setBusy(false);
    if (r.ok) setNts(r.data); else setMsg({ tone: "error", text: r.data.message ?? "조회하지 못했습니다." });
  }
  async function remove() {
    if (!window.confirm("기업 프로필과 관련 이력(관심 공고·검색/열람 이력·알림)을 모두 삭제합니다. 계속할까요?")) return;
    const r = await api("DELETE", "/api/company");
    if (r.ok) window.location.reload();
  }

  if (state === "none" || state === "rejected") {
    return (
      <form onSubmit={claim} className="card grid max-w-xl gap-4 p-5" aria-label="기업 관계 확인 신청">
        <h2 className="font-bold">1단계. 기업 관계 확인 신청</h2>
        <p className="text-sm">기업 프로필·이력·관심 공고는 <strong>기업 관계 확인이 완료된 후</strong>에만 이용할 수 있습니다. 사업자등록번호는 공개될 수 있는 식별값이므로 번호만으로는 인증되지 않으며, 신청은 담당자 검토 후 승인됩니다.</p>
        {state === "rejected" && <Notice tone="warn">이전 신청이 승인되지 않았습니다. 문의가 필요합니다.</Notice>}
        <div><label htmlFor="bizNo" className="label">사업자등록번호</label><input id="bizNo" name="bizNo" required inputMode="numeric" placeholder="000-00-00000" className="input" autoComplete="off" /></div>
        {msg && <p role="alert" className="text-sm text-red-700">{msg.text}</p>}
        <button className="btn" disabled={busy || state === "rejected"}>신청하기</button>
        <p className="text-xs text-[var(--muted)]">입력한 번호는 암호화 저장되고 화면에는 마스킹되어 표시됩니다. 이 단계 없이도 공고 검색과 <a className="underline" href="/recommend">맞춤 추천 체험</a>은 가능합니다.</p>
      </form>
    );
  }
  if (state === "pending") {
    return <Notice>기업 관계 확인 신청이 접수되었습니다. 승인 전에는 기업 프로필·이력·관심 공고를 이용할 수 없습니다. (승인은 담당자 검토 후 진행)</Notice>;
  }
  return (
    <div className="grid gap-6">
      <section className="card grid gap-3 p-5" aria-labelledby="nts">
        <h2 id="nts" className="font-bold">사업자 상태 조회 (국세청)</h2>
        <p className="text-sm text-[var(--muted)]">등록된 기업: {company?.business_number_masked} · 상태조회는 사업자 상태·과세유형만 확인합니다. 대표자명·주소·매출 등은 이 조회로 가져오지 않으며 직접 입력(선택)해야 합니다.</p>
        <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
          <div><label htmlFor="bizNo2" className="label">사업자등록번호 재입력</label><input id="bizNo2" name="bizNo" required inputMode="numeric" className="input" autoComplete="off" /></div>
          <button className="btn" disabled={busy}>상태 조회</button>
        </form>
        {nts && (
          <div role="status" className="rounded-lg border border-[var(--line)] p-3 text-sm">
            {nts.notice && <p className="mb-1 font-semibold text-amber-800">⚠ {nts.notice}</p>}
            <p>사업자 상태: <strong>{nts.status.statusText ?? "확인 불가"}</strong> · 과세유형: {nts.status.taxType ?? "-"}{nts.status.closedAt ? ` · 폐업일 ${nts.status.closedAt}` : ""}</p>
          </div>
        )}
        {company?.business_status && !nts && <p className="text-sm">저장된 상태: {company.business_status} ({company.profile_source === "nts_status_mock" ? "테스트 데이터" : "국세청 상태조회"})</p>}
      </section>
      <form onSubmit={save} className="card grid gap-4 p-5" aria-label="기업 프로필">
        <h2 className="font-bold">기업정보 (모두 선택 입력)</h2>
        <Notice>입력한 정보는 맞춤 적합성 분석에만 사용되며, 본인(확인된 대표 계정)만 조회·수정·삭제할 수 있습니다. 미입력 항목은 ‘미충족’이 아니라 ‘확인 필요’로 처리됩니다.</Notice>
        <ProfileFields v={company ?? {}} />
        {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={`text-sm ${msg.tone === "error" ? "text-red-700" : "text-green-800"}`}>{msg.text}</p>}
        <div className="flex gap-2"><button className="btn" disabled={busy}>저장</button><button type="button" className="btn btn-danger" onClick={remove}>기업정보·이력 삭제</button></div>
      </form>
    </div>
  );
}
