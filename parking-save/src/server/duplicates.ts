// 중복/연결 후보 검토 (ADMIN_DATA.md: 중복 후보 확인 및 병합 승인). 승인(MERGED)은 레코드를 합치지 않고 '동일 시설' 연결만 기록한다.
import type { Db } from "./db";
import { audit } from "./admin";

export interface PendingCandidate {
  id: number; score: number | null; reason: string | null; createdAt: string;
  a: { id: number; source: string; name: string; address: string | null; totalSpaces: number | null };
  b: { id: number; source: string; name: string; address: string | null; totalSpaces: number | null };
}

export async function listPending(db: Db, limit = 100): Promise<PendingCandidate[]> {
  const rows = await db.all<any>(
    `SELECT c.id, c.score, c.reason, c.created_at,
       a.id aid, a.source_name asrc, a.name aname, COALESCE(a.road_address, a.address) aaddr, a.total_spaces aspaces,
       b.id bid, b.source_name bsrc, b.name bname, COALESCE(b.road_address, b.address) baddr, b.total_spaces bspaces
     FROM duplicate_candidates c JOIN parking_lots a ON a.id=c.lot_a_id JOIN parking_lots b ON b.id=c.lot_b_id
     WHERE c.status='PENDING' ORDER BY c.score DESC, c.id LIMIT ?`, [limit]);
  return rows.map((r) => ({ id: r.id, score: r.score, reason: r.reason, createdAt: r.created_at,
    a: { id: r.aid, source: r.asrc, name: r.aname, address: r.aaddr, totalSpaces: r.aspaces },
    b: { id: r.bid, source: r.bsrc, name: r.bname, address: r.baddr, totalSpaces: r.bspaces } }));
}

/** 승인(MERGED)/거절(REJECTED). 이미 결정된 후보는 변경하지 않는다. 감사로그를 남긴다 */
export async function decide(db: Db, id: number, decision: "MERGED" | "REJECTED", by: string): Promise<boolean> {
  const who = by.trim().slice(0, 60);
  if (!who) throw new Error("결정자 이름이 필요합니다.");
  const r = await db.run("UPDATE duplicate_candidates SET status=?, decided_by=?, decided_at=? WHERE id=? AND status='PENDING'", [decision, who, new Date().toISOString(), id]);
  await audit(db, `duplicate:${decision === "MERGED" ? "approve" : "reject"}`, r.changes ? "OK" : "REJECTED", `cli:${who}`, r.changes ? `candidate ${id}` : `candidate ${id} not pending`);
  return r.changes > 0;
}
