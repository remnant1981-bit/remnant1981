// 신청 진행 관리: 기업 구성원이 함께 보는 공고별 진행 단계·담당자·목표일·메모.
// 모든 접근은 서버에서 '확인 완료된 기업 구성원'인지 검사한다(클라이언트의 company_id 를 받지 않음).
import { newId } from "@/lib/crypto";
import { nowIso, isValidYmd } from "@/lib/time";
import { ApiError } from "./auth";
import type { Db } from "./db";
import { requireCompanyAccess } from "./company";
import { STAGE_IDS } from "@/domain/pipeline";

const ID = /^[0-9a-f]{32}$/;
const NOTE_MAX = 2000;

export interface PipelineItem {
  announcement_id: string; stage: string; assignee_user_id: string | null; assignee_email: string | null; target_date: string | null;
  updated_at: string; title: string; organization: string; application_end: string | null; application_status: string; note_count: number;
}
export interface PipelineNote { id: string; body: string; created_at: string; author: string | null }

async function annId(db: Db, id: unknown): Promise<string> {
  if (typeof id !== "string" || !ID.test(id) || !(await db.get("SELECT 1 AS x FROM announcements WHERE id=?", [id]))) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  return id;
}

export async function listMembers(db: Db, companyId: string): Promise<{ id: string; email: string }[]> {
  return db.all(`SELECT u.id, u.email FROM company_members m JOIN users u ON u.id=m.user_id WHERE m.company_id=? AND m.verification_status='verified' ORDER BY u.email`, [companyId]);
}

export async function listPipeline(db: Db, userId: string): Promise<{ items: PipelineItem[]; members: { id: string; email: string }[] }> {
  const cid = await requireCompanyAccess(db, userId, null);
  const items = await db.all<PipelineItem>(
    `SELECT p.announcement_id, p.stage, p.assignee_user_id, u.email AS assignee_email, p.target_date, p.updated_at,
            a.title, a.organization, a.application_end, a.application_status,
            (SELECT COUNT(*) FROM pipeline_notes n WHERE n.company_id=p.company_id AND n.announcement_id=p.announcement_id) AS note_count
     FROM pipeline_items p JOIN announcements a ON a.id=p.announcement_id LEFT JOIN users u ON u.id=p.assignee_user_id
     WHERE p.company_id=? ORDER BY COALESCE(a.application_end, '9999-12-31'), p.updated_at DESC LIMIT 500`, [cid]);
  return { items, members: await listMembers(db, cid) };
}

export async function getPipelineItem(db: Db, companyId: string, announcementId: string) {
  const item = await db.get<{ stage: string; assignee_user_id: string | null; target_date: string | null }>(
    "SELECT stage, assignee_user_id, target_date FROM pipeline_items WHERE company_id=? AND announcement_id=?", [companyId, announcementId]);
  if (!item) return null;
  const notes = await db.all<PipelineNote>(
    `SELECT n.id, n.body, n.created_at, u.email AS author FROM pipeline_notes n LEFT JOIN users u ON u.id=n.user_id
     WHERE n.company_id=? AND n.announcement_id=? ORDER BY n.created_at DESC LIMIT 100`, [companyId, announcementId]);
  return { ...item, notes };
}

/** 진행 건 추가·수정. 보낸 항목만 변경(stage 는 새로 만들 때 기본 '관심'). */
export async function savePipelineItem(db: Db, userId: string, input: { announcementId?: unknown; stage?: unknown; assigneeUserId?: unknown; targetDate?: unknown }) {
  const cid = await requireCompanyAccess(db, userId, null);
  const aid = await annId(db, input.announcementId);
  const cur = await db.get<{ stage: string; assignee_user_id: string | null; target_date: string | null }>(
    "SELECT stage, assignee_user_id, target_date FROM pipeline_items WHERE company_id=? AND announcement_id=?", [cid, aid]);
  let stage = cur?.stage ?? "interested";
  if (input.stage !== undefined) {
    if (typeof input.stage !== "string" || !STAGE_IDS.includes(input.stage)) throw new ApiError(400, "invalid_input", "진행 단계 값이 올바르지 않습니다.");
    stage = input.stage;
  }
  let assignee = cur?.assignee_user_id ?? null;
  if (input.assigneeUserId !== undefined) {
    if (input.assigneeUserId === null || input.assigneeUserId === "") assignee = null;
    else {
      // 담당자는 같은 기업의 확인 완료된 구성원만
      const ok = typeof input.assigneeUserId === "string" && (await listMembers(db, cid)).some((m) => m.id === input.assigneeUserId);
      if (!ok) throw new ApiError(400, "invalid_input", "담당자를 확인해 주세요.");
      assignee = input.assigneeUserId as string;
    }
  }
  let target = cur?.target_date ?? null;
  if (input.targetDate !== undefined) {
    if (input.targetDate === null || input.targetDate === "") target = null;
    else if (typeof input.targetDate === "string" && isValidYmd(input.targetDate)) target = input.targetDate;
    else throw new ApiError(400, "invalid_input", "목표일을 확인해 주세요.");
  }
  const now = nowIso();
  await db.run(
    `INSERT INTO pipeline_items(company_id, announcement_id, stage, assignee_user_id, target_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(company_id, announcement_id) DO UPDATE SET stage=excluded.stage, assignee_user_id=excluded.assignee_user_id, target_date=excluded.target_date, updated_at=excluded.updated_at`,
    [cid, aid, stage, assignee, target, userId, now, now]);
  return { announcementId: aid, stage, assigneeUserId: assignee, targetDate: target };
}

export async function removePipelineItem(db: Db, userId: string, announcementId: unknown) {
  const cid = await requireCompanyAccess(db, userId, null);
  if (typeof announcementId !== "string" || !ID.test(announcementId)) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  await db.run("DELETE FROM pipeline_notes WHERE company_id=? AND announcement_id=?", [cid, announcementId]);
  await db.run("DELETE FROM pipeline_items WHERE company_id=? AND announcement_id=?", [cid, announcementId]);
  return { ok: true };
}

export async function addPipelineNote(db: Db, userId: string, input: { announcementId?: unknown; body?: unknown }) {
  const cid = await requireCompanyAccess(db, userId, null);
  const aid = await annId(db, input.announcementId);
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > NOTE_MAX) throw new ApiError(400, "invalid_input", `메모는 1~${NOTE_MAX}자로 입력해 주세요.`);
  if (!(await db.get("SELECT 1 AS x FROM pipeline_items WHERE company_id=? AND announcement_id=?", [cid, aid]))) {
    await savePipelineItem(db, userId, { announcementId: aid }); // 메모만 남겨도 '관심'으로 등록
  }
  const id = newId();
  await db.run("INSERT INTO pipeline_notes(id, company_id, announcement_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)", [id, cid, aid, userId, body, nowIso()]);
  return { id };
}

export async function removePipelineNote(db: Db, userId: string, noteId: unknown) {
  const cid = await requireCompanyAccess(db, userId, null);
  if (typeof noteId !== "string" || !ID.test(noteId)) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  // 같은 기업의 메모만, 작성자 본인만 삭제
  const r = await db.run("DELETE FROM pipeline_notes WHERE id=? AND company_id=? AND user_id=?", [noteId, cid, userId]);
  if (!r.changes) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  return { ok: true };
}

/** 공고 카드 표시용: 기업의 공고별 진행 단계 */
export async function pipelineStages(db: Db, companyId: string): Promise<Map<string, string>> {
  const rows = await db.all<{ announcement_id: string; stage: string }>("SELECT announcement_id, stage FROM pipeline_items WHERE company_id=?", [companyId]);
  return new Map(rows.map((r) => [r.announcement_id, r.stage]));
}
