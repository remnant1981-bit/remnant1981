import { NextResponse } from "next/server";
import { isGuardError, requireAdmin } from "@/server/admin-guard";
import { apiError, internalError } from "@/server/http";

export const dynamic = "force-dynamic";

/** 보정 화면용: 시설의 현재 요금 규칙·운영시간, 보정 이력 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req, "admin:lot");
  if (isGuardError(g)) return g;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "ID가 올바르지 않습니다.");
  try {
    const lot = await g.db.get<{ id: number; name: string; road_address: string | null; address: string | null; fee_note: string | null; source_name: string; source_updated_at: string | null }>(
      "SELECT id, name, road_address, address, fee_note, source_name, source_updated_at FROM parking_lots WHERE id=?", [Number(id)]);
    if (!lot) return apiError(404, "NOT_FOUND", "없는 시설입니다.");
    const feeRules = await g.db.all("SELECT rule_type, amount, duration_minutes, valid_day_type, start_time, end_time, daily_max_basis FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [lot.id]);
    const schedules = await g.db.all("SELECT day_type, open_time, close_time, all_day_flag, closed_flag, holiday_policy FROM operating_schedules WHERE parking_lot_id=? ORDER BY id", [lot.id]);
    const history = await g.db.all("SELECT id, kind, payload_json, note, report_id, status, created_by, created_at, ended_by, ended_at FROM lot_overrides WHERE parking_lot_id=? ORDER BY created_at DESC, id DESC LIMIT 30", [lot.id]);
    return NextResponse.json({ lot, feeRules, schedules, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return internalError(e); }
}
