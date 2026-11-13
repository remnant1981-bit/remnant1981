import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { companyPlan, plansEnabled } from "@/server/plans";
import { PLANS, PLAN_IDS } from "@/domain/plans";
import { Notice, PageTitle } from "@/components/ui";
import { PlanSignup } from "@/components/PlanSignup";
import { billingStatus, paymentInfo } from "@/server/billing";

export const metadata: Metadata = { title: "요금 안내", alternates: { canonical: "/pricing" } };

const won = (n: number) => (n === 0 ? "0원" : `${n.toLocaleString()}원`);

export default async function Page() {
  const v = await getViewer();
  const db = await getDb();
  const plan = v.company ? await companyPlan(db, v.company.id) : null;
  const billing = v.company && v.session ? await billingStatus(db, v.session.user.id) : null;
  const pay = paymentInfo();
  return (
    <>
      <PageTitle sub="공고 검색과 맞춤 추천은 계속 무료입니다. 유료 요금제는 신청 업무를 돕는 기능을 제공합니다.">요금 안내</PageTitle>
      {!plansEnabled() && <div className="mb-4"><Notice>현재 <strong>모든 기능을 무료로 이용</strong>할 수 있습니다(정식 유료 전환 전). 아래 요금은 예정안이며 바뀔 수 있습니다.</Notice></div>}
      {plan && <div className="mb-4"><Notice>{v.company?.company_name ?? "우리 기업"}의 현재 요금제: <strong>{plan.label}</strong>{plan.status === "trial" && ` (체험 중, ${plan.endsAt}까지)`}{plan.status === "active" && ` (${plan.endsAt}까지)`}{plan.status === "expired" && ` (기간 종료: ${plan.endsAt}, 무료 한도 적용 중)`}</Notice></div>}
      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const current = plan?.plan === id && plan.status !== "expired";
          return (
            <section key={id} aria-labelledby={`pl-${id}`} className={`card grid content-start gap-3 p-5 ${current ? "ring-2 ring-[var(--brand)]" : ""}`}>
              <h2 id={`pl-${id}`} className="text-lg font-bold">{p.label}{current && <span className="chip ml-2 align-middle bg-[var(--brand-soft)] text-[var(--brand)]">이용 중</span>}</h2>
              <p><span className="text-2xl font-extrabold">{won(p.priceMonthly)}</span>{p.priceMonthly > 0 && <span className="text-sm text-[var(--muted)]"> / 월 (연 {won(p.priceYearly)})</span>}</p>
              <p className="text-sm text-[var(--muted)]">사용자 {p.seats}{p.priceMonthly > 0 && " · 부가세 별도"}</p>
              <ul className="grid gap-1 text-sm">{p.features.map((f) => <li key={f}>✔ {f}</li>)}</ul>
            </section>
          );
        })}
      </div>
      {billing && v.session ? <PlanSignup initial={billing} defaultEmail={v.session.user.email} /> : (
        <section className="card mt-6 grid gap-2 p-5 text-sm">
          <h2 className="font-bold">체험·이용 신청</h2>
          <p>유료 요금제는 <strong>14일 무료 체험</strong>(기업당 1회) 후 계좌이체(세금계산서 발행)로 이용할 수 있습니다. 카드 정기결제는 준비 중입니다.</p>
          {!v.session ? <p><Link className="underline" href="/login">로그인</Link> 또는 <Link className="underline" href="/register">회원가입</Link> 후 기업 관계 확인이 끝나면 이 화면에서 바로 체험·신청할 수 있습니다.</p>
            : <p>기업 관계 확인이 끝나면 이 화면에서 바로 체험·신청할 수 있습니다. <Link className="underline" href="/company">기업정보 화면</Link></p>}
        </section>
      )}
      <section className="card mt-4 grid gap-2 p-5 text-sm">
        <h2 className="font-bold">결제·이용 안내</h2>
        <ul className="list-disc grid gap-1 pl-5">
          <li>연 결제는 2개월 할인(10개월 요금)이며, Team 추가 인원도 같은 기준으로 계산합니다. 모든 금액은 부가세 별도입니다.</li>
          <li>입금 확인 후 이용 기간이 시작됩니다. 같은 요금제를 기간 중에 다시 결제하면 기존 종료일 다음 날부터 이어집니다.</li>
          <li>기간이 끝나도 입력한 기업정보·진행 관리·메모는 유지되며, 무료 한도를 넘는 새 항목만 추가가 제한됩니다.</li>
          <li>이용약관·환불 규정은 확정 후 게시합니다.</li>
        </ul>
        <p>문의: {pay.contact ?? <span className="text-[var(--muted)]">[운영자 연락처 확정 후 표시]</span>}</p>
        <p><Link className="underline" href="/recommend">우리 기업 공고 보기</Link></p>
      </section>
    </>
  );
}
