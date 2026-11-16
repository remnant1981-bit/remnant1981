import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { Notice, PageTitle } from "@/components/ui";
export const metadata: Metadata = { title: "로그인", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const joined = (await searchParams).notice === "joined";
  return (<><PageTitle sub="로그인 없이도 공고 검색과 열람은 가능합니다.">로그인</PageTitle>
    {joined && <div className="mx-auto mb-4 max-w-md"><Notice>가입 요청을 처리했습니다. 로그인해 주세요. 이미 가입된 이메일이라면 기존 비밀번호로 로그인하면 됩니다.</Notice></div>}
    <AuthForm mode="login" /><p className="mt-4 text-center text-sm">계정이 없나요? <Link className="underline" href="/register">회원가입</Link></p></>);
}
