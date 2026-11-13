"use client";
// 요금제 셀프 체험·계좌이체 이용 신청(유료화 1단계). 금액 표시는 참고용이며 서버가 다시 계산해 저장한다.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { CYCLES, PAID_PLAN_IDS, TRIAL_DAYS, quote, seatRange, type Cycle, type PaidPlanId } from "@/domain/billing";
import { PLANS } from "@/domain/plans";
import type { BillingStatus, PlanRequestRow } from "@/server/billing";

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString()}원`;
const STATUS: Record<PlanRequestRow["status"], string> = { pending: "입금 확인 대기", approved: "완료", rejected: "반려", cancelled: "취소" };

export function PlanSignup({ initial, defaultEmail }: { initial: BillingStatus; defaultEmail: string }) {
  const router = useRouter();
  const [st, setSt] = useState(initial);
  const [plan, setPlan] = useState<PaidPlanId>("pro");
  const [cycle, setCycle] = useState<Cycle>("yearly");
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const range = seatRange(plan);
  const q = quote(plan, cycle, Math.min(range.max, Math.max(range.min, seats || range.min)));

  async function run(p: Promise<{ ok: boolean; data: any }>, ok: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (r.ok) { setSt(r.data as BillingStatus); setMsg(ok); router.refresh(); }
    else setMsg(r.data?.message ?? "처리하지 못했습니다.");
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(api("POST", "/api/billing/requests", {
      plan, cycle, seats: q.seats, depositorName: f.get("depositorName"), invoiceEmail: f.get("invoiceEmail"), memo: f.get("memo"), agree: f.get("agree") === "on",
    }), "신청을 접수했습니다. 아래 안내에 따라 입금해 주세요.");
  }

  const p = st.pending;
  return (
    <section aria-labelledby="ps" className="card mt-6 grid gap-4 p-5 text-sm">
      <h2 id="ps" className="text-lg font-bold">체험·이용 신청</h2>
      <p aria-live="polite" className={msg ? "font-medium text-[var(--brand)]" : "sr-only"}>{msg}</p>

      {st.trialAvailable && (
        <div className="grid gap-2 rounded-lg border border-[var(--line)] p-4">
          <h3 className="font-bold">{TRIAL_DAYS}일 무료 체험</h3>
          <p className="text-[var(--muted)]">결제 정보 없이 바로 시작합니다. 기업당 1회, 끝나면 자동으로 무료 요금제로 돌아가며 입력한 데이터는 유지됩니다.</p>
          <div className="flex flex-wrap gap-2">
            {PAID_PLAN_IDS.map((id) => (
              <button key={id} type="button" className="btn" disabled={busy}
                onClick={() => { if (confirm(`${PLANS[id].label} ${TRIAL_DAYS}일 무료 체험을 시작할까요? (기업당 1회)`)) run(api("POST", "/api/billing/trial", { plan: id }), `${PLANS[id].label} 체험을 시작했습니다.`); }}>
                {PLANS[id].label} 체험 시작
              </button>
            ))}
          </div>
        </div>
      )}

      {p ? (
        <div className="grid gap-2 rounded-lg border-2 border-[var(--brand)] p-4" aria-labelledby="pp">
          <h3 id="pp" className="font-bold">입금 안내 <span className="chip ml-1 bg-[var(--brand-soft)] text-[var(--brand)]">{STATUS.pending}</span></h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-[var(--muted)]">신청 내용</dt><dd>{PLANS[p.plan].label} · {p.cycle ? CYCLES[p.cycle].label : ""} · {p.seats}명</dd>
            <dt className="text-[var(--muted)]">입금액</dt><dd><strong className="text-base">{won(p.amount_total)}</strong> <span className="text-[var(--muted)]">(공급가 {won(p.amount_supply)} + 부가세 {won(p.amount_vat)})</span></dd>
            <dt className="text-[var(--muted)]">입금 계좌</dt><dd>{st.payment.bankAccount ?? <span className="text-[var(--muted)]">운영자가 확인 후 연락드립니다</span>}</dd>
            <dt className="text-[var(--muted)]">입금자명</dt><dd>{p.depositor_name}</dd>
            <dt className="text-[var(--muted)]">세금계산서</dt><dd>{p.invoice_email}</dd>
          </dl>
          <p className="text-[var(--muted)]">입금이 확인되면 요금제가 활성화되고 이 화면에 표시됩니다(영업일 기준 1일 이내). 체험 중이면 체험은 그대로 이어집니다.{st.payment.contact && <> 문의: {st.payment.contact}</>}</p>
          <div><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { if (confirm("신청을 취소할까요?")) run(api("DELETE", "/api/billing/requests", { requestId: p.id }), "신청을 취소했습니다."); }}>신청 취소</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-[var(--line)] p-4" aria-labelledby="pf">
          <h3 id="pf" className="font-bold">이용 신청(계좌이체·세금계산서)</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1">요금제
              <select className="input" value={plan} onChange={(e) => { const v = e.target.value as PaidPlanId; setPlan(v); setSeats(seatRange(v).min); }}>
                {PAID_PLAN_IDS.map((id) => <option key={id} value={id}>{PLANS[id].label}</option>)}
              </select>
            </label>
            <label className="grid gap-1">결제 주기
              <select className="input" value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}>
                {(Object.keys(CYCLES) as Cycle[]).map((c) => <option key={c} value={c}>{CYCLES[c].label}</option>)}
              </select>
            </label>
            <label className="grid gap-1">인원
              <input className="input" type="number" min={range.min} max={range.max} value={seats} disabled={range.min === range.max}
                onChange={(e) => setSeats(Number(e.target.value))} aria-describedby="seat-help" />
              <span id="seat-help" className="text-xs text-[var(--muted)]">{plan === "team" ? "기본 5명, 추가 1명당 월 5,000원" : "1명"}</span>
            </label>
          </div>
          <p className="rounded bg-[var(--brand-soft)] p-3">
            입금 예정액 <strong className="text-base">{won(q.total)}</strong>
            <span className="text-[var(--muted)]"> = 기본 {won(q.base)}{q.extra > 0 && ` + 추가 ${q.extraSeats}명 ${won(q.extra)}`} + 부가세 {won(q.vat)} · {q.months}개월</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">입금자명<input name="depositorName" className="input" required maxLength={40} autoComplete="organization" /></label>
            <label className="grid gap-1">세금계산서 받을 이메일<input name="invoiceEmail" type="email" className="input" required maxLength={254} defaultValue={defaultEmail} /></label>
          </div>
          <label className="grid gap-1">요청사항(선택)<textarea name="memo" className="input" rows={2} maxLength={500} placeholder="세금계산서 담당자, 발행일 요청 등" /></label>
          <label className="flex items-start gap-2"><input name="agree" type="checkbox" required className="mt-1" />
            <span>입금 확인 후 이용 기간이 시작되며, 기간이 끝나면 무료 한도로 돌아가고 데이터는 유지됨을 확인했습니다. 환불은 게시된 환불 규정을 따릅니다.</span></label>
          <div><button className="btn" disabled={busy}>{busy ? "처리 중…" : "신청하기"}</button></div>
        </form>
      )}

      {st.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[var(--muted)]">신청 내역 {st.history.length}건</summary>
          <ul className="mt-2 grid gap-1">
            {st.history.map((r) => (
              <li key={r.id} className="border-b py-1">
                {r.created_at.slice(0, 10)} · {r.kind === "trial" ? `${PLANS[r.plan].label} 무료 체험` : `${PLANS[r.plan].label} ${r.cycle ? CYCLES[r.cycle].label : ""} ${r.seats}명 ${won(r.amount_total)}`} · {r.kind === "trial" ? "시작" : STATUS[r.status]}
                {r.status === "rejected" && r.admin_memo && <span className="text-[var(--muted)]"> ({r.admin_memo})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
