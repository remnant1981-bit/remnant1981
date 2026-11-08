// 비회원 맞춤 정보: 이용자 브라우저 쿠키에만 보관(서버 DB 저장 없음).
// 식별 정보(사업자번호·기업명·대표자명)는 넣지 않고, 적합성 판정에 쓰는 항목만 담는다.
export const GUEST_COOKIE = "gbf_guest_profile";
export const GUEST_KEYS = [
  "region_sido", "region_sigungu", "industry_name", "established_at", "enterprise_size", "revenue_band", "employee_count_band",
  "export_status", "research_institute_status", "venture_status", "has_patent", "youth_ceo", "certifications", "tech_keywords", "interest_categories",
] as const;

export function encodeGuestProfile(p: Record<string, unknown>): string {
  const o: Record<string, string> = {};
  for (const k of GUEST_KEYS) { const v = p[k]; if (typeof v === "string" && v.trim()) o[k] = v.trim().slice(0, 200); }
  return encodeURIComponent(JSON.stringify(o));
}

export function decodeGuestProfile(raw: string | undefined | null): Record<string, string> | null {
  if (!raw || raw.length > 3500) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raw));
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const out: Record<string, string> = {};
    for (const k of GUEST_KEYS) if (typeof o[k] === "string") out[k] = o[k];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** 브라우저에서만 호출: 비회원 맞춤 정보를 쿠키(180일)에 저장. */
export function writeGuestCookie(p: Record<string, unknown>): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${GUEST_COOKIE}=${encodeGuestProfile(p)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax${secure}`;
}

/** 브라우저에서만 호출: 현재 쿠키의 비회원 정보에 일부 항목을 덧붙여 저장. */
export function patchGuestCookie(patch: Record<string, string>): void {
  const m = document.cookie.split("; ").find((x) => x.startsWith(`${GUEST_COOKIE}=`));
  const cur = decodeGuestProfile(m ? m.slice(GUEST_COOKIE.length + 1) : null) ?? {};
  writeGuestCookie({ ...cur, ...patch });
}
