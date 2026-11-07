import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { PageTitle } from "@/components/ui";
export const metadata: Metadata = { title: "회원가입", robots: { index: false } };
export default function Page() {
  return (<><PageTitle sub="저장(관심 공고·이력·알림)이 필요할 때 가입하세요.">회원가입</PageTitle><AuthForm mode="register" /><p className="mt-4 text-center text-sm">이미 계정이 있나요? <Link className="underline" href="/login">로그인</Link></p></>);
}
