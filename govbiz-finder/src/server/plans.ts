// 기업별 요금제 판정과 관리자 설정(유료화 설계 B단계).
// - PLANS_ENABLED=true 일 때만 한도를 적용한다(판매 개시 전 기본값: 제한 없음).
// - 기간이 끝나면 데이터는 그대로 두고 무료 한도만 적용한다(새로 추가하는 것만 막음).
import { nowIso, seoulToday, isValidYmd } from "@/lib/time";
import { ApiError } from "./auth";
import type { Db } from "./db";
import { audit } from "./admin";
import { PLANS, PLAN_IDS, UNLIMITED, type PlanId, type PlanLimits } from "@/domain/plans";

export const plansEnabled = () => process.env.PLANS_ENABLED === "true";

export interface EffectivePlan {
  plan: PlanId; label: string;
  status: "free" | "trial" | "active" | "expired";
  endsAt: string | null; seats: number;
  limits: PlanLimits; enforced: boolean;
}
interface SubRow { plan: PlanId; seats: number; trial_ends_at: string | null; paid_until: string | null }

export function resolvePlan(row: SubRow | undefined | null, today = seoulToday(), enforced = plansEnabled()): EffectivePlan {
  let plan: PlanId = "free";
  let status: EffectivePlan["status"] = "free";
  let endsAt: string | null = null;
  if (row && row.plan !== "free") {
    if (row.paid_until && row.paid_until >= today) { plan = row.plan; status = "active"; endsAt = row.paid_until; }
    else if (row.trial_ends_at && row.trial_ends_at >= today) { plan = row.plan; status = "trial"; endsAt = row.trial_ends_at; }
    else { status = "expired"; endsAt = row.paid_until ?? row.trial_ends_at; }
  }
  const def = PLANS[plan];
  const limits = enforced ? def.limits : { ...UNLIMITED, ads: def.limits.ads };
  return { plan, label: def.label, status, endsAt, seats: row?.seats ?? 1, limits, enforced };
}

export async function companyPlan(db: Db, companyId: string | null | undefined, today = seoulToday()): Promise<EffectivePlan> {
  if (!companyId) return resolvePlan(null, today);
  const row = await db.get<SubRow>("SELECT plan, seats, trial_ends_at, paid_until FROM subscriptions WHERE company_id=?", [companyId]);
  return resolvePlan(row, today);
}

export function planLimitError(message: string): ApiError {
  return new ApiError(403, "plan_limit", message);
}

// ---------- 관리자 ----------
export async function listSubscriptions(db: Db) {
  const rows = await db.all<{ company_id: string; company_name: string | null; business_number_masked: string; members: number; plan: string | null; seats: number | null; trial_ends_at: string | null; paid_until: string | null; memo: string | null; updated_at: string | null }>(
    `SELECT c.id AS company_id, c.company_name, c.business_number_masked,
            (SELECT COUNT(*) FROM company_members m WHERE m.company_id=c.id AND m.verification_status='verified') AS members,
            s.plan, s.seats, s.trial_ends_at, s.paid_until, s.memo, s.updated_at
     FROM companies c LEFT JOIN subscriptions s ON s.company_id=c.id
     WHERE EXISTS (SELECT 1 FROM company_members m WHERE m.company_id=c.id AND m.verification_status='verified')
     ORDER BY s.updated_at DESC NULLS LAST, c.company_name LIMIT 500`);
  const today = seoulToday();
  // 현재 실제 적용 상태(만료 시 무료)를 함께 내려 관리자가 저장 결과를 바로 확인
  return rows.map((r) => { const e = resolvePlan(r.plan ? { ...r, plan: r.plan as PlanId } : null, today); return { ...r, effective: { plan: e.plan, label: e.label, status: e.status, endsAt: e.endsAt } }; });
}

export async function setSubscription(db: Db, adminId: string, input: Record<string, unknown>) {
  const cid = typeof input.companyId === "string" ? input.companyId : "";
  if (!/^[0-9a-f]{32}$/.test(cid) || !(await db.get("SELECT 1 AS x FROM companies WHERE id=?", [cid]))) throw new ApiError(404, "not_found", "기업을 찾을 수 없습니다.");
  const plan = input.plan;
  if (typeof plan !== "string" || !PLAN_IDS.includes(plan as PlanId)) throw new ApiError(400, "invalid_input", "요금제 값이 올바르지 않습니다.");
  const seats = input.seats === undefined || input.seats === "" ? 1 : Number(input.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 100) throw new ApiError(400, "invalid_input", "인원은 1~100으로 입력해 주세요.");
  const date = (v: unknown, label: string) => {
    if (v === undefined || v === null || v === "") return null;
    if (!isValidYmd(v)) throw new ApiError(400, "invalid_input", `${label}을 확인해 주세요.`);
    return v;
  };
  const trial = date(input.trialEndsAt, "체험 종료일");
  const paid = date(input.paidUntil, "이용 종료일");
  // 종료일 없는 유료 요금제는 즉시 '만료'로 판정되어 무료 한도가 적용되므로 저장 단계에서 막는다
  if (plan !== "free" && !trial && !paid) throw new ApiError(400, "invalid_input", "유료 요금제는 이용 종료일(결제) 또는 체험 종료일을 입력해 주세요.");
  const memo = typeof input.memo === "string" ? input.memo.slice(0, 500) : null;
  await db.run(
    `INSERT INTO subscriptions(company_id, plan, seats, trial_ends_at, paid_until, memo, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(company_id) DO UPDATE SET plan=excluded.plan, seats=excluded.seats, trial_ends_at=excluded.trial_ends_at,
       paid_until=excluded.paid_until, memo=excluded.memo, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    [cid, plan, seats, trial, paid, memo, adminId, nowIso()]);
  await audit(db, adminId, "subscription.set", "company", cid, { plan, seats, trial, paid });
  return companyPlan(db, cid);
}
