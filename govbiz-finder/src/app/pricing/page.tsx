import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/viewer";
import { getDb } from "@/server/db";
import { companyPlan, plansEnabled } from "@/server/plans";
import { PLANS, PLAN_IDS } from "@/domain/plans";
import { Notice, PageTitle } from "@/components/ui";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "요금 안내", alternates: { canonical: "/pricing" } };

const won = (n: number) => (n === 0 ? "0원" : `${n.toLocaleString()}원`);

export default async function Page() {
  if (!plansEnabled()) notFound(); // 요금제 미사용(기본) 상태에서는 요금 안내를 노출하지 않음
  const v = await getViewer();
  const plan = v.company ? await companyPlan(await getDb(), v.company.id) : null;
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
      <section className="card mt-6 grid gap-2 p-5 text-sm">
        <h2 className="font-bold">도입·체험 문의</h2>
        <p>유료 요금제는 <strong>14일 무료 체험</strong> 후 계좌이체(세금계산서 발행)로 이용할 수 있습니다. 카드 정기결제는 준비 중입니다.</p>
        <p>문의: <span className="text-[var(--muted)]">[운영자 연락처 확정 후 표시]</span></p>
        <p className="text-[var(--muted)]">기간이 끝나도 입력한 기업정보·진행 관리·메모는 유지되며, 무료 한도를 넘는 새 항목만 추가가 제한됩니다. 이용약관·환불 규정은 확정 후 게시합니다.</p>
        <p><Link className="underline" href="/recommend">우리 기업 공고 보기</Link></p>
      </section>
    </>
  );
}
