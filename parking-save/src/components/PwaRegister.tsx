"use client";
import { useEffect } from "react";

/** 서비스 워커 등록(운영 빌드에서만). 실패해도 앱 동작에는 영향 없음 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* 지원 안 함·차단: 무시 */ });
  }, []);
  return null;
}
