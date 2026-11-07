import { encryptText, hmacHex, isValidBizNoChecksum, maskBizNo, newId, normalizeBizNo } from "@/lib/crypto";
import { isValidYmd, nowIso, seoulToday } from "@/lib/time";
import { REVENUE_BANDS, EMPLOYEE_BANDS, SIDO } from "@/domain/taxonomy";
import type { CompanyProfile } from "@/domain/matching";
import { ApiError } from "./auth";
import type { Db } from "./db";
import { getNtsAdapter, NtsError, type NtsAdapter, type NtsStatus } from "./nts";
import { rateLimit } from "./auth";

export const PROFILE_FIELDS = [
  "company_name", "representative_name", "region_sido", "region_sigungu", "industry_name", "established_at", "revenue_band",
  "employee_count_band", "research_institute_status", "venture_status", "export_status", "tech_keywords",
] as const;
export type ProfileInput = Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>>;

const str = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ApiError(400, "invalid_input", "입력 형식이 올바르지 않습니다.");
  const t = v.replace(/\u0000/g, "").trim();
  if (t === "") return null;
  if (t.length > max) throw new ApiError(400, "invalid_input", "입력값이 너무 깁니다.");
  return t;
};
const oneOf = (v: unknown, list: readonly string[], label: string): string | null => {
  const s = str(v, 60);
  if (s !== null && !list.includes(s)) throw new ApiError(400, "invalid_input", `${label} 값이 올바르지 않습니다.`);
  return s;
};

/** 선택 입력 프로필 검증. 미입력은 null(= 확인 필요). */
export function validateProfile(input: Record<string, unknown>): Record<(typeof PROFILE_FIELDS)[number], string | null> {
  const est = str(input.established_at, 10);
  if (est !== null && (!isValidYmd(est) || est > seoulToday())) throw new ApiError(400, "invalid_input", "설립일을 확인해 주세요.");
  return {
    company_name: str(input.company_name, 100),
    representative_name: str(input.representative_name, 50),
    region_sido: oneOf(input.region_sido, SIDO, "시/도"),
    region_sigungu: str(input.region_sigungu, 40),
    industry_name: str(input.industry_name, 100),
    established_at: est,
    revenue_band: oneOf(input.revenue_band, REVENUE_BANDS, "매출 규모"),
    employee_count_band: oneOf(input.employee_count_band, EMPLOYEE_BANDS, "종업원 수"),
    research_institute_status: oneOf(input.research_institute_status, ["yes", "no"], "연구소 여부"),
    venture_status: oneOf(input.venture_status, ["yes", "no"], "벤처기업 여부"),
    export_status: oneOf(input.export_status, ["yes", "no"], "수출 여부"),
    tech_keywords: str(input.tech_keywords, 200),
  };
}

/** 사업자번호 형식·체크섬 검증 후 정규화. */
export function parseBizNo(input: unknown): string {
  if (typeof input !== "string") throw new ApiError(400, "invalid_biz_no", "사업자등록번호 형식을 확인해 주세요.");
  const d = normalizeBizNo(input);
  if (!d || !isValidBizNoChecksum(d)) throw new ApiError(400, "invalid_biz_no", "사업자등록번호 형식을 확인해 주세요.");
  return d;
}

/**
 * 상태조회. 사업자번호만으로는 저장된 기업 정보를 찾거나 노출하지 않는다(조회 결과는 국세청 응답뿐).
 */
export async function ntsStatusLookup(db: Db, bizNoRaw: unknown, ipKey: string, adapter: NtsAdapter = getNtsAdapter()): Promise<NtsStatus & { masked: string }> {
  await rateLimit(db, `nts:${ipKey}`, 20, 600);
  const bizNo = parseBizNo(bizNoRaw);
  try {
    const st = await adapter.lookupStatus(bizNo);
    return { ...st, bizNo: "", masked: maskBizNo(bizNo) }; // 응답에 전체 번호를 되돌려주지 않는다
  } catch (e) {
    if (e instanceof NtsError) {
      const msg = e.kind === "rate_limit" ? "국세청 API 호출 제한에 도달했습니다. 잠시 후 다시 시도해 주세요." : "국세청 상태조회에 일시적으로 실패했습니다. 다시 시도해 주세요.";
      throw new ApiError(502, "nts_" + e.kind, msg);
    }
    throw e;
  }
}

/** 요청 사용자가 해당 기업의 '확인 완료' 구성원인지 서버에서 검증. 존재 여부를 구분하지 않는다. */
export async function requireCompanyAccess(db: Db, userId: string, companyId: string | null | undefined): Promise<string> {
  if (companyId) {
    const m = await db.get("SELECT 1 AS x FROM company_members WHERE user_id=? AND company_id=? AND verification_status='verified'", [userId, companyId]);
    if (!m) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
    return companyId;
  }
  const m = await db.get<{ company_id: string }>(
    "SELECT company_id FROM company_members WHERE user_id=? AND verification_status='verified' ORDER BY created_at LIMIT 1", [userId]);
  if (!m) throw new ApiError(403, "company_not_verified", "기업 관계 확인이 완료된 후 이용할 수 있습니다.");
  return m.company_id;
}

export async function membershipState(db: Db, userId: string) {
  const rows = await db.all<{ company_id: string; verification_status: string; created_at: string }>(
    "SELECT company_id, verification_status, created_at FROM company_members WHERE user_id=? ORDER BY created_at", [userId]);
  const verified = rows.find((r) => r.verification_status === "verified");
  const pending = rows.find((r) => r.verification_status === "pending");
  return { status: verified ? "verified" : pending ? "pending" : rows.length ? "rejected" : "none", companyId: verified?.company_id ?? null };
}

/**
 * 기업 관계 확인 신청. 계정 생성과 분리된 단계.
 * - 이미 같은 번호의 기업이 있어도 기존 프로필/존재 여부를 응답에 노출하지 않는다.
 * - 신청은 항상 pending 이며, 승인(관리자 검토 등) 전에는 어떤 기업 데이터에도 접근할 수 없다.
 */
export async function requestCompanyClaim(db: Db, userId: string, bizNoRaw: unknown) {
  const bizNo = parseBizNo(bizNoRaw);
  await rateLimit(db, `claim:${userId}`, 5, 3600);
  const state = await membershipState(db, userId);
  if (state.status === "verified" || state.status === "pending") return { status: state.status === "verified" ? "verified" : "pending" };
  const lookup = await hmacHex("APP_HMAC_KEY", "biz:" + bizNo);
  let company = await db.get<{ id: string }>("SELECT id FROM companies WHERE business_number_lookup_hash=?", [lookup]);
  const now = nowIso();
  if (!company) {
    const id = newId();
    await db.run(
      "INSERT INTO companies(id, business_number_ciphertext, business_number_lookup_hash, business_number_masked, profile_source, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [id, await encryptText(bizNo), lookup, maskBizNo(bizNo), "user_input", now, now]);
    company = { id };
  }
  await db.run("INSERT OR IGNORE INTO company_members(id, company_id, user_id, role, verification_status, created_at) VALUES (?,?,?,?, 'pending', ?)",
    [newId(), company.id, userId, "owner", now]);
  if (process.env.DEV_AUTO_APPROVE_COMPANY === "true" && process.env.NODE_ENV !== "production") {
    await approveClaim(db, userId, company.id, "dev_auto_approve", "dev");
    return { status: "verified" };
  }
  return { status: (await membershipState(db, userId)).status };
}

/** 관리자 승인. 기업당 대표 계정 1개 정책: 이미 대표가 있으면 거절한다. */
export async function approveClaim(db: Db, userId: string, companyId: string, method: string, reviewer: string) {
  const owner = await db.get("SELECT 1 AS x FROM company_members WHERE company_id=? AND verification_status='verified' AND user_id<>?", [companyId, userId]);
  if (owner) throw new ApiError(409, "owner_exists", "이미 확인된 대표 계정이 있는 기업입니다. 기존 대표 계정 해제 후 승인하세요.");
  const r = await db.run(
    "UPDATE company_members SET verification_status='verified', verification_method=?, verified_at=?, reviewed_by=? WHERE company_id=? AND user_id=? AND verification_status='pending'",
    [method, nowIso(), reviewer, companyId, userId]);
  if (!r.changes) throw new ApiError(404, "not_found", "승인 대기 중인 신청이 없습니다.");
}
export async function rejectClaim(db: Db, userId: string, companyId: string, reviewer: string) {
  const r = await db.run("UPDATE company_members SET verification_status='rejected', reviewed_by=? WHERE company_id=? AND user_id=? AND verification_status='pending'", [reviewer, companyId, userId]);
  if (!r.changes) throw new ApiError(404, "not_found", "승인 대기 중인 신청이 없습니다.");
}

export interface CompanyView extends CompanyProfile {
  id: string; business_number_masked: string | null; company_name: string | null; representative_name: string | null;
  tax_type: string | null; profile_source: string | null; profile_verified_at: string | null; tech_keywords: string | null;
}
const VIEW_COLS = `id, business_number_masked, company_name, representative_name, region_sido, region_sigungu, industry_name, established_at,
  revenue_band, employee_count_band, research_institute_status, venture_status, export_status, tech_keywords, business_status, tax_type,
  profile_source, profile_verified_at`;

export async function getCompanyProfile(db: Db, userId: string, companyId?: string | null): Promise<CompanyView> {
  const id = await requireCompanyAccess(db, userId, companyId);
  const row = await db.get<CompanyView>(`SELECT ${VIEW_COLS} FROM companies WHERE id=?`, [id]);
  if (!row) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  return row;
}

export async function saveCompanyProfile(db: Db, userId: string, input: Record<string, unknown>, companyId?: string | null) {
  const id = await requireCompanyAccess(db, userId, companyId);
  const p = validateProfile(input);
  await db.run(
    `UPDATE companies SET company_name=?, representative_name=?, region_sido=?, region_sigungu=?, industry_name=?, established_at=?, revenue_band=?,
      employee_count_band=?, research_institute_status=?, venture_status=?, export_status=?, tech_keywords=?, updated_at=? WHERE id=?`,
    [p.company_name, p.representative_name, p.region_sido, p.region_sigungu, p.industry_name, p.established_at, p.revenue_band,
      p.employee_count_band, p.research_institute_status, p.venture_status, p.export_status, p.tech_keywords, nowIso(), id]);
  return getCompanyProfile(db, userId, id);
}

/** 인증된 구성원이 국세청 상태조회 결과를 자신의 기업에 반영. 응답 원문은 저장하지 않고 요약 상태만 저장. */
export async function applyNtsStatus(db: Db, userId: string, bizNoRaw: unknown, ipKey: string, companyId?: string | null, adapter?: NtsAdapter) {
  const id = await requireCompanyAccess(db, userId, companyId);
  const bizNo = parseBizNo(bizNoRaw);
  const lookup = await hmacHex("APP_HMAC_KEY", "biz:" + bizNo);
  const mine = await db.get("SELECT 1 AS x FROM companies WHERE id=? AND business_number_lookup_hash=?", [id, lookup]);
  if (!mine) throw new ApiError(400, "biz_no_mismatch", "등록된 기업의 사업자등록번호와 일치하지 않습니다.");
  const st = await ntsStatusLookup(db, bizNo, ipKey, adapter);
  await db.run("UPDATE companies SET business_status=?, tax_type=?, profile_source=?, profile_verified_at=?, updated_at=? WHERE id=?",
    [st.statusText, st.taxType, st.isMock ? "nts_status_mock" : "nts_status", nowIso(), nowIso(), id]);
  return st;
}

/** 기업 프로필 삭제: 단독 구성원이면 기업·이력 전체(연쇄) 삭제, 아니면 본인 구성원 관계만 해제. */
export async function deleteCompanyData(db: Db, userId: string, companyId?: string | null) {
  const id = await requireCompanyAccess(db, userId, companyId);
  await db.run("DELETE FROM bookmarks WHERE user_id=? AND company_id=?", [userId, id]);
  await db.run("DELETE FROM search_history WHERE user_id=? AND company_id=?", [userId, id]);
  await db.run("DELETE FROM view_history WHERE user_id=? AND company_id=?", [userId, id]);
  await db.run("DELETE FROM notifications WHERE user_id=? AND company_id=?", [userId, id]);
  await db.run("DELETE FROM notification_settings WHERE user_id=? AND company_id=?", [userId, id]);
  await db.run("DELETE FROM company_members WHERE user_id=? AND company_id=?", [userId, id]);
  const left = await db.get("SELECT 1 AS x FROM company_members WHERE company_id=? AND verification_status='verified'", [id]);
  if (!left) await db.run("DELETE FROM companies WHERE id=?", [id]);
}
