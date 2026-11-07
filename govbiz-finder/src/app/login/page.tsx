import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { PageTitle } from "@/components/ui";
export const metadata: Metadata = { title: "로그인", robots: { index: false } };
export default function Page() {
  return (<><PageTitle sub="로그인 없이도 공고 검색과 열람은 가능합니다.">로그인</PageTitle><AuthForm mode="login" /><p className="mt-4 text-center text-sm">계정이 없나요? <Link className="underline" href="/register">회원가입</Link></p></>);
}
