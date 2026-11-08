"use client";
import { useRouter } from "next/navigation";
import { GUEST_COOKIE } from "@/lib/guest-profile";

/** 비회원 저장 정보 지우기(이 브라우저의 쿠키만 삭제). */
export function GuestProfileClear() {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-ghost" onClick={() => {
      document.cookie = `${GUEST_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      try { sessionStorage.removeItem("gbf_profile_draft"); } catch { /* 무시 */ }
      router.push("/recommend");
      router.refresh();
    }}>이 브라우저에서 내 정보 지우기</button>
  );
}
