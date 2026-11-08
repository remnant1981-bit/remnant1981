import { createHash, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

/** 토큰이 설정되지 않았거나 너무 짧으면 관리자 API는 비활성(안전한 기본값) */
export const MIN_ADMIN_TOKEN_LENGTH = 32;
export const adminToken = () => {
  const t = process.env.ADMIN_API_TOKEN ?? "";
  return t.length >= MIN_ADMIN_TOKEN_LENGTH ? t : null;
};

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Authorization: Bearer <token> 상수 시간 비교(길이 노출 방지를 위해 해시 후 비교) */
export function verifyBearer(header: string | null, expected: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m) return false;
  return timingSafeEqual(sha(m[1]), sha(expected));
}

const salt = () => process.env.ADMIN_AUDIT_SALT || "parking-save-audit";
export const hashClient = (key: string) => createHash("sha256").update(salt() + key).digest("hex").slice(0, 16);

export async function audit(db: Db, action: string, outcome: "OK" | "DENIED" | "FAILED" | "REJECTED", clientKey: string, detail?: string) {
  await db.run("INSERT INTO admin_audit_logs(at, action, outcome, client_hash, detail) VALUES (?,?,?,?,?)",
    [new Date().toISOString(), action, outcome, hashClient(clientKey), detail ? detail.slice(0, 120) : null]);
}
