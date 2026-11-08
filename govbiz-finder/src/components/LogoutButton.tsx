"use client";
import { useRouter } from "next/navigation";
import { api, resetCsrf } from "@/lib/client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button type="button" className="underline" onClick={async () => { await api("POST", "/api/auth/logout"); resetCsrf(); router.push("/"); router.refresh(); }}>
      로그아웃
    </button>
  );
}
