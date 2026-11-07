import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/viewer";
import { CompanyPanel } from "@/components/CompanyPanel";
import { PageTitle } from "@/components/ui";
export const metadata: Metadata = { title: "기업정보", robots: { index: false, follow: false } };
export default async function Page() {
  const v = await getViewer();
  if (!v.session) redirect("/login");
  return (<><PageTitle sub="기업정보 입력은 선택사항이며, 입력하지 않아도 검색·열람은 가능합니다.">기업정보</PageTitle>
    <CompanyPanel membership={v.membership} company={v.company as never} /></>);
}
