"use client";
import { api } from "@/lib/client";
export function MyActions({ kind }: { kind: "read" | "clear" }) {
  return kind === "read"
    ? <button className="btn btn-ghost" onClick={async () => { await api("POST", "/api/notifications/read"); location.reload(); }}>모두 읽음</button>
    : <button className="btn btn-ghost" onClick={async () => { if (confirm("검색·열람 이력을 모두 삭제할까요?")) { await api("DELETE", "/api/history"); location.reload(); } }}>이력 삭제</button>;
}
