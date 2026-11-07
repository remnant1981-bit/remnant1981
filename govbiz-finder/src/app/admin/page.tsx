import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/server/viewer";
import { AdminPanel } from "@/components/AdminPanel";
import { PageTitle } from "@/components/ui";
export const metadata: Metadata = { title: "관리자", robots: { index: false, follow: false } };
export default async function Page() {
  const v = await getViewer();
  if (v.session?.user.role !== "admin") notFound(); // 서버 측 권한 확인, 존재 노출 최소화
  return (<><PageTitle sub="공고·수집·기업 관계 확인 관리">관리자</PageTitle><AdminPanel /></>);
}
