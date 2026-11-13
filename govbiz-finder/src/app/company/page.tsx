import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/viewer";
import { CompanyPanel } from "@/components/CompanyPanel";
import { PageTitle } from "@/components/ui";
import Link from "next/link";
import { getDb } from "@/server/db";
import { companyPlan } from "@/server/plans";
export const metadata: Metadata = { title: "기업정보", robots: { index: false, follow: false } };
export default async function Page() {
  const v = await getViewer();
  if (!v.session) redirect("/login");
  const plan = v.company ? await companyPlan(await getDb(), v.company.id) : null;
  return (<><PageTitle sub="기업정보 입력은 선택사항이며, 입력하지 않아도 검색·열람은 가능합니다.">기업정보</PageTitle>
    {plan && <p className="card mb-4 p-3 text-sm">요금제: <strong>{plan.label}</strong>{plan.status === "trial" && ` · 체험 ${plan.endsAt}까지`}{plan.status === "active" && ` · ${plan.endsAt}까지`}{plan.status === "expired" && ` · 기간 종료(${plan.endsAt}), 무료 한도 적용`} · <Link className="underline" href="/pricing">요금 안내</Link></p>}
    <CompanyPanel membership={v.membership} company={v.company as never} /></>);
}
