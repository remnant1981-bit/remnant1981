import { headers } from "next/headers";
import { getDb } from "./db";
import { getSession, type SessionCtx } from "./auth";
import { getCompanyProfile, membershipState, validateProfile, type CompanyView } from "./company";
import type { CompanyProfile } from "@/domain/matching";
import { decodeGuestProfile, GUEST_COOKIE } from "@/lib/guest-profile";
import { parseCookies } from "./auth";

export interface Viewer {
  session: SessionCtx | null;
  membership: "none" | "pending" | "verified" | "rejected";
  company: CompanyView | null;
  /** 적합성 판정용 프로필: 회원 기업정보 또는 비회원 브라우저 저장 정보 */
  profile: CompanyProfile | null;
  guestProfile: Record<string, string> | null;
}

/** 쿠키 문자열에서 비회원 프로필을 읽고 서버 검증을 통과한 값만 사용한다. */
export function guestProfileFromCookie(cookieHeader: string | null): Record<string, string> | null {
  const raw = decodeGuestProfile(parseCookies(cookieHeader)[GUEST_COOKIE]);
  if (!raw) return null;
  try {
    const v = validateProfile(raw);
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) if (x) out[k] = x;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** 서버 컴포넌트용: 쿠키 세션을 검증하고, 확인 완료된 기업이 있을 때만 기업 프로필을 로드. */
export async function getViewer(): Promise<Viewer> {
  const db = await getDb();
  const h = await headers();
  const cookie = h.get("cookie");
  const session = await getSession(db, cookie);
  const guest = guestProfileFromCookie(cookie);
  if (!session) return { session: null, membership: "none", company: null, profile: guest, guestProfile: guest };
  const st = await membershipState(db, session.user.id);
  const membership = st.status as Viewer["membership"];
  const company = st.status === "verified" ? await getCompanyProfile(db, session.user.id, st.companyId) : null;
  return { session, membership, company, profile: company ?? guest, guestProfile: company ? null : guest };
}
