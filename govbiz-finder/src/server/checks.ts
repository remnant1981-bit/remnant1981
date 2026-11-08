// 공고별 조건 직접 확인 결과(회원: DB, 비회원: 쿠키). 해당 공고의 판정에만 반영된다.
import type { Db } from "./db";
import { ApiError, parseCookies } from "./auth";
import { requireCompanyAccess } from "./company";
import { CHECKS_COOKIE, decodeChecks, type ChecksMap } from "@/lib/guest-checks";
import { nowIso } from "@/lib/time";

const FK = /^[a-z_]{2,40}$/;

export async function loadCompanyChecks(db: Db, companyId: string): Promise<ChecksMap> {
  const rows = await db.all<{ announcement_id: string; field_key: string; verdict: "yes" | "no" }>(
    "SELECT announcement_id, field_key, verdict FROM announcement_checks WHERE company_id=?", [companyId]);
  const out: ChecksMap = {};
  for (const r of rows) (out[r.announcement_id] ??= {})[r.field_key] = r.verdict;
  return out;
}

export function guestChecksFromCookie(cookieHeader: string | null): ChecksMap {
  return decodeChecks(parseCookies(cookieHeader)[CHECKS_COOKIE]);
}

export async function saveCompanyCheck(db: Db, userId: string, input: { announcementId?: unknown; fieldKey?: unknown; verdict?: unknown }) {
  const companyId = await requireCompanyAccess(db, userId, null);
  const aid = typeof input.announcementId === "string" ? input.announcementId : "";
  const fk = typeof input.fieldKey === "string" ? input.fieldKey : "";
  const v = input.verdict;
  if (!FK.test(fk) || !(v === "yes" || v === "no" || v === "")) throw new ApiError(400, "invalid_input", "입력값이 올바르지 않습니다.");
  const a = await db.get("SELECT 1 AS x FROM announcements WHERE id=?", [aid]);
  if (!a) throw new ApiError(404, "not_found", "공고를 찾을 수 없습니다.");
  if (v === "") await db.run("DELETE FROM announcement_checks WHERE company_id=? AND announcement_id=? AND field_key=?", [companyId, aid, fk]);
  else await db.run(
    `INSERT INTO announcement_checks(company_id, announcement_id, field_key, verdict, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(company_id, announcement_id, field_key) DO UPDATE SET verdict=excluded.verdict, updated_at=excluded.updated_at`,
    [companyId, aid, fk, v, nowIso()]);
  return { ok: true };
}
