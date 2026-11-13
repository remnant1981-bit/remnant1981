// 유료화 1단계: 셀프 체험(기업당 1회) + 계좌이체 이용 신청 → 관리자 입금 확인 후 활성화.
// - 기업은 서버에서 '확인 완료된 기업 구성원' 기준으로 판별(클라이언트 company_id 를 받지 않음).
// - 금액은 서버에서 계산해 저장(화면 계산값을 믿지 않음).
// - 계좌·연락처는 환경변수(BILLING_BANK_ACCOUNT, BILLING_CONTACT)로만 설정(코드·저장소에 기록하지 않음).
import { newId } from "@/lib/crypto";
import { nowIso, seoulToday } from "@/lib/time";
import { ApiError, normalizeEmail, rateLimit } from "./auth";
import type { Db } from "./db";
import { audit } from "./admin";
import { requireCompanyAccess } from "./company";
import { companyPlan, type EffectivePlan } from "./plans";
import { CYCLES, PAID_PLAN_IDS, paidPeriod, quote, seatRange, trialEnd, type Cycle, type PaidPlanId } from "@/domain/billing";

const ID = /^[0-9a-f]{32}$/;

export interface PlanRequestRow {
  id: string; kind: "trial" | "paid"; plan: PaidPlanId; cycle: Cycle | null; seats: number;
  amount_supply: number | null; amount_vat: number | null; amount_total: number | null;
  depositor_name: string | null; invoice_email: string | null; memo: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled"; admin_memo: string | null; processed_at: string | null; created_at: string;
}
export interface PaymentInfo { bankAccount: string | null; contact: string | null }
export interface BillingStatus { plan: EffectivePlan; trialAvailable: boolean; pending: PlanRequestRow | null; history: PlanRequestRow[]; payment: PaymentInfo }

export const paymentInfo = (): PaymentInfo => ({
  bankAccount: process.env.BILLING_BANK_ACCOUNT?.trim() || null,
  contact: process.env.BILLING_CONTACT?.trim() || null,
});

const COLS = `id, kind, plan, cycle, seats, amount_supply, amount_vat, amount_total, depositor_name, invoice_email, memo, status, admin_memo, processed_at, created_at`;

async function trialAvailable(db: Db, companyId: string): Promise<boolean> {
  if (await db.get("SELECT 1 AS x FROM plan_requests WHERE company_id=? AND kind='trial'", [companyId])) return false;
  // 관리자가 이미 체험·결제를 설정한 기업은 셀프 체험 대상 아님
  const sub = await db.get<{ trial_ends_at: string | null; paid_until: string | null }>("SELECT trial_ends_at, paid_until FROM subscriptions WHERE company_id=?", [companyId]);
  return !sub || (!sub.trial_ends_at && !sub.paid_until);
}

export async function billingStatus(db: Db, userId: string): Promise<BillingStatus> {
  const cid = await requireCompanyAccess(db, userId, null);
  const history = await db.all<PlanRequestRow>(`SELECT ${COLS} FROM plan_requests WHERE company_id=? ORDER BY created_at DESC LIMIT 20`, [cid]);
  return {
    plan: await companyPlan(db, cid),
    trialAvailable: await trialAvailable(db, cid),
    pending: history.find((r) => r.kind === "paid" && r.status === "pending") ?? null,
    history,
    payment: paymentInfo(),
  };
}

function paidPlan(v: unknown): PaidPlanId {
  if (typeof v !== "string" || !PAID_PLAN_IDS.includes(v as PaidPlanId)) throw new ApiError(400, "invalid_input", "요금제를 선택해 주세요.");
  return v as PaidPlanId;
}

/** 14일 무료 체험 시작(기업당 1회). 기존 결제 기간은 건드리지 않음 */
export async function startTrial(db: Db, userId: string, input: { plan?: unknown }) {
  const cid = await requireCompanyAccess(db, userId, null);
  const plan = paidPlan(input.plan);
  if (!(await trialAvailable(db, cid))) throw new ApiError(409, "trial_used", "무료 체험은 기업당 한 번만 이용할 수 있습니다.");
  const today = seoulToday();
  const ends = trialEnd(today);
  const seats = seatRange(plan).min;
  try {
    await db.run(
      `INSERT INTO plan_requests(id, company_id, user_id, kind, plan, seats, status, processed_at, created_at) VALUES (?,?,?,'trial',?,?,'approved',?,?)`,
      [newId(), cid, userId, plan, seats, nowIso(), nowIso()]);
  } catch {
    throw new ApiError(409, "trial_used", "무료 체험은 기업당 한 번만 이용할 수 있습니다."); // 동시 요청(고유 인덱스)
  }
  await db.run(
    `INSERT INTO subscriptions(company_id, plan, seats, trial_ends_at, paid_until, memo, updated_by, updated_at) VALUES (?,?,?,?,NULL,?,?,?)
     ON CONFLICT(company_id) DO UPDATE SET plan=excluded.plan, seats=excluded.seats, trial_ends_at=excluded.trial_ends_at, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    [cid, plan, seats, ends, `셀프 체험 시작 ${today}`, userId, nowIso()]);
  return billingStatus(db, userId);
}

/** 계좌이체 이용 신청(기업당 대기 1건). 금액은 서버 계산 */
export async function createPlanRequest(db: Db, userId: string, input: Record<string, unknown>) {
  const cid = await requireCompanyAccess(db, userId, null);
  await rateLimit(db, `plan_request:${userId}`, 10, 3600);
  const plan = paidPlan(input.plan);
  if (typeof input.cycle !== "string" || !(input.cycle in CYCLES)) throw new ApiError(400, "invalid_input", "결제 주기를 선택해 주세요.");
  const cycle = input.cycle as Cycle;
  const range = seatRange(plan);
  const seats = input.seats === undefined || input.seats === "" ? range.min : Number(input.seats);
  if (!Number.isInteger(seats) || seats < range.min || seats > range.max)
    throw new ApiError(400, "invalid_input", range.min === range.max ? `${plan === "pro" ? "Pro" : "Team"} 요금제 인원은 ${range.min}명입니다.` : `인원은 ${range.min}~${range.max}명으로 입력해 주세요.`);
  const depositor = typeof input.depositorName === "string" ? input.depositorName.trim() : "";
  if (depositor.length < 1 || depositor.length > 40) throw new ApiError(400, "invalid_input", "입금자명을 1~40자로 입력해 주세요.");
  const email = typeof input.invoiceEmail === "string" ? normalizeEmail(input.invoiceEmail) : null;
  if (!email) throw new ApiError(400, "invalid_input", "세금계산서 받을 이메일을 확인해 주세요.");
  const memo = typeof input.memo === "string" && input.memo.trim() ? input.memo.trim().slice(0, 500) : null;
  if (input.agree !== true) throw new ApiError(400, "invalid_input", "결제·환불 안내에 동의해 주세요.");
  const q = quote(plan, cycle, seats);
  if (await db.get("SELECT 1 AS x FROM plan_requests WHERE company_id=? AND kind='paid' AND status='pending'", [cid]))
    throw new ApiError(409, "request_pending", "처리 대기 중인 신청이 있습니다. 취소 후 다시 신청해 주세요.");
  try {
    await db.run(
      `INSERT INTO plan_requests(id, company_id, user_id, kind, plan, cycle, seats, amount_supply, amount_vat, amount_total, depositor_name, invoice_email, memo, status, created_at)
       VALUES (?,?,?,'paid',?,?,?,?,?,?,?,?,?,'pending',?)`,
      [newId(), cid, userId, plan, cycle, seats, q.supply, q.vat, q.total, depositor, email, memo, nowIso()]);
  } catch {
    throw new ApiError(409, "request_pending", "처리 대기 중인 신청이 있습니다. 취소 후 다시 신청해 주세요.");
  }
  return billingStatus(db, userId);
}

export async function cancelPlanRequest(db: Db, userId: string, input: { requestId?: unknown }) {
  const cid = await requireCompanyAccess(db, userId, null);
  const id = typeof input.requestId === "string" && ID.test(input.requestId) ? input.requestId : "";
  const r = await db.run("UPDATE plan_requests SET status='cancelled', processed_at=? WHERE id=? AND company_id=? AND kind='paid' AND status='pending'", [nowIso(), id, cid]);
  if (!r.changes) throw new ApiError(404, "not_found", "취소할 신청을 찾을 수 없습니다.");
  return billingStatus(db, userId);
}

// ---------- 관리자 ----------
export async function listPlanRequests(db: Db) {
  return db.all<PlanRequestRow & { company_id: string; company_name: string | null; business_number_masked: string; email: string | null }>(
    `SELECT r.${COLS.split(", ").join(", r.")}, r.company_id, c.company_name, c.business_number_masked, u.email
     FROM plan_requests r JOIN companies c ON c.id=r.company_id LEFT JOIN users u ON u.id=r.user_id
     WHERE r.kind='paid' ORDER BY (r.status='pending') DESC, r.created_at DESC LIMIT 200`);
}

/** 승인 = 입금 확인. 이용 종료일 계산 후 요금제 활성화(같은 요금제가 유효하면 이어서 연장) */
export async function decidePlanRequest(db: Db, adminId: string, input: Record<string, unknown>) {
  const id = typeof input.requestId === "string" && ID.test(input.requestId) ? input.requestId : "";
  const decision = input.decision;
  if (decision !== "approve" && decision !== "reject") throw new ApiError(400, "invalid_input", "처리 구분이 올바르지 않습니다.");
  const adminMemo = typeof input.adminMemo === "string" && input.adminMemo.trim() ? input.adminMemo.trim().slice(0, 500) : null;
  const req = await db.get<PlanRequestRow & { company_id: string }>(`SELECT ${COLS}, company_id FROM plan_requests WHERE id=? AND kind='paid'`, [id]);
  if (!req) throw new ApiError(404, "not_found", "신청을 찾을 수 없습니다.");
  if (req.status !== "pending") throw new ApiError(409, "already_processed", "이미 처리된 신청입니다.");
  const upd = await db.run("UPDATE plan_requests SET status=?, admin_memo=?, processed_by=?, processed_at=? WHERE id=? AND status='pending'",
    [decision === "approve" ? "approved" : "rejected", adminMemo, adminId, nowIso(), id]);
  if (!upd.changes) throw new ApiError(409, "already_processed", "이미 처리된 신청입니다.");
  if (decision === "reject") {
    await audit(db, adminId, "plan_request.reject", "company", req.company_id, { requestId: id });
    return { status: "rejected" as const };
  }
  const sub = await db.get<{ plan: string; paid_until: string | null; trial_ends_at: string | null; memo: string | null }>(
    "SELECT plan, paid_until, trial_ends_at, memo FROM subscriptions WHERE company_id=?", [req.company_id]);
  const today = seoulToday();
  const period = paidPeriod(today, CYCLES[req.cycle!].months, sub?.plan === req.plan ? sub.paid_until : null);
  const line = `${today} 입금 확인 ${req.amount_total?.toLocaleString()}원(${req.plan}/${req.cycle}/${req.seats}명, ${period.start}~${period.end})`;
  const memo = [line, sub?.memo].filter(Boolean).join(" | ").slice(0, 500);
  await db.run(
    `INSERT INTO subscriptions(company_id, plan, seats, trial_ends_at, paid_until, memo, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(company_id) DO UPDATE SET plan=excluded.plan, seats=excluded.seats, paid_until=excluded.paid_until, memo=excluded.memo,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    [req.company_id, req.plan, req.seats, sub?.trial_ends_at ?? null, period.end, memo, adminId, nowIso()]);
  await audit(db, adminId, "plan_request.approve", "company", req.company_id, { requestId: id, plan: req.plan, cycle: req.cycle, seats: req.seats, total: req.amount_total, paidUntil: period.end });
  return { status: "approved" as const, paidFrom: period.start, paidUntil: period.end, plan: await companyPlan(db, req.company_id) };
}
