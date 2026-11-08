"use client";
import { api } from "@/lib/client";
import { patchGuestCookie } from "@/lib/guest-profile";

/** 기업정보 일부 저장. 회원(기업 확인 완료)은 서버에, 게스트는 이 브라우저 쿠키에만 저장. */
export async function saveProfilePatch(member: boolean, patch: Record<string, string>): Promise<string | null> {
  if (member) {
    const r = await api<any>("PATCH", "/api/company", patch);
    return r.ok ? null : (r.data?.message ?? "저장하지 못했습니다.");
  }
  patchGuestCookie(patch);
  return null;
}
