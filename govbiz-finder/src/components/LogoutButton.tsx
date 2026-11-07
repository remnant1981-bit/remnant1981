"use client";
import { api, resetCsrf } from "@/lib/client";

export function LogoutButton() {
  return (
    <button type="button" className="underline" onClick={async () => { await api("POST", "/api/auth/logout"); resetCsrf(); window.location.href = "/"; }}>
      로그아웃
    </button>
  );
}
