import { headers } from "next/headers";
import { getDb } from "./db";
import { getSession, type SessionCtx } from "./auth";
import { getCompanyProfile, membershipState, type CompanyView } from "./company";

export interface Viewer {
  session: SessionCtx | null;
  membership: "none" | "pending" | "verified" | "rejected";
  company: CompanyView | null;
}

/** 서버 컴포넌트용: 쿠키 세션을 검증하고, 확인 완료된 기업이 있을 때만 기업 프로필을 로드. */
export async function getViewer(): Promise<Viewer> {
  const db = await getDb();
  const h = await headers();
  const session = await getSession(db, h.get("cookie"));
  if (!session) return { session: null, membership: "none", company: null };
  const st = await membershipState(db, session.user.id);
  const membership = st.status as Viewer["membership"];
  const company = st.status === "verified" ? await getCompanyProfile(db, session.user.id, st.companyId) : null;
  return { session, membership, company };
}
