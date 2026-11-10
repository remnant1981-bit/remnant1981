import { createHash } from "node:crypto";
import { finishedIso } from "@/lib/time";
import type { Db } from "@/server/db";
import type { SourceAdapter, RawRow, NormalizedLot } from "./types";
import { normalizeStandardRow } from "./standard-parking";
import { findCandidates } from "./dedupe";
import { resolveKeyCollisions, type Candidate } from "./collisions";

export interface SyncSummary { status: "SUCCESS" | "PARTIAL" | "FAILED"; keyCollisions: number; collisionSuperseded: number; collisionSplit: number; received: number; inserted: number; updated: number; unchanged: number; excluded: number; invalid: number; errors: number; duplicateCandidates: number }

const stable = (row: RawRow) => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k] ?? null]));
const sha = (x: string) => createHash("sha256").update(x).digest("hex");

/**
 * 수집 → 원천 보존 → 정규화 → 저장 → 중복 후보 → 로그.
 * 한 행의 오류가 전체를 중단하지 않는다(건수만 기록). 원천에서 사라진 시설은 삭제하지 않는다.
 */
export async function runSync(db: Db, adapter: SourceAdapter, now = new Date()): Promise<SyncSummary> {
  const startedAt = now.toISOString();
  const t0 = performance.now(); // 종료 시각 = 주입된 시작 시각 + 실제 경과(테스트에서 시계 주입 시 결정적, 운영에서는 실제 시각과 같음)
  const sum: SyncSummary = { status: "SUCCESS", keyCollisions: 0, collisionSuperseded: 0, collisionSplit: 0, received: 0, inserted: 0, updated: 0, unchanged: 0, excluded: 0, invalid: 0, errors: 0, duplicateCandidates: 0 };
  const logId = (await db.run("INSERT INTO source_sync_logs(source_name, started_at, status) VALUES (?,?, 'RUNNING')", [adapter.sourceName, startedAt])).lastId; // 동시 수집에서도 자기 로그 행을 가리킴
  const touched: number[] = [];
  let fatal: string | null = null;
  let newestBase: string | null = null;
  try {
    // 1단계: 수집·정규화(범위 제외/형식 불량은 즉시 집계). 같은 관리번호 판정은 전체를 모은 뒤에 해야 수집 순서와 무관해진다
    const pending: Array<Candidate<{ row: RawRow; lot: NormalizedLot }>> = [];
    for await (const row of adapter.fetch()) {
      sum.received++;
      try {
        const res = normalizeStandardRow(row);
        if (res.kind === "invalid") { sum.invalid++; continue; }
        const key = (row["주차장관리번호"] ?? "").trim();
        if (res.kind === "excluded") {
          sum.excluded++;
          await db.run("UPDATE parking_lots SET data_status='EXCLUDED_SCOPE', updated_at=? WHERE source_name=? AND source_record_id=?", [startedAt, adapter.sourceName, key]);
          continue;
        }
        pending.push({ key, lat: res.lot.latitude, lng: res.lot.longitude, date: res.lot.sourceUpdatedAt, seq: pending.length, payload: { row, lot: res.lot } });
      } catch (e) {
        sum.errors++;
        console.error("[sync] row error", adapter.sourceName, e instanceof Error ? e.message : e);
      }
    }
    // 2단계: 같은 관리번호 반복 판정 — 같은 장소(50m 이내)는 기준일이 최신인 행만, 다른 장소는 별도 시설로 보존(사용자 결정 2026-11-08 + 실데이터 확인)
    const plan = resolveKeyCollisions(pending);
    sum.collisionSuperseded = plan.superseded; sum.collisionSplit = plan.split; sum.keyCollisions = plan.superseded + plan.split;
    // 3단계: 저장
    // 500건씩 한 트랜잭션으로 커밋(건별 커밋은 fsync 때문에 전체 적재가 수 배 느림). 청크 중간 실패는 행 단위로 집계되며 이미 커밋된 청크는 유지
    const CHUNK = 500;
    for (let off = 0; off < plan.items.length; off += CHUNK) await db.transaction(async () => {
    for (const { id: key, item, collided } of plan.items.slice(off, off + CHUNK)) {
      try {
        const { row, lot } = item.payload;
        if (collided) lot.qualityFlags.push("SOURCE_KEY_COLLISION");
        const hash = sha(stable(row));
        if (lot.sourceUpdatedAt && (!newestBase || lot.sourceUpdatedAt > newestBase)) newestBase = lot.sourceUpdatedAt;
        await db.run("INSERT OR IGNORE INTO source_raw_records(source_name, source_record_id, payload_json, payload_hash, source_updated_at, collected_at) VALUES (?,?,?,?,?,?)",
          [adapter.sourceName, key, JSON.stringify(row), hash, lot.sourceUpdatedAt, startedAt]);
        const raw = (await db.get<{ id: number }>("SELECT id FROM source_raw_records WHERE source_name=? AND source_record_id=? AND payload_hash=?", [adapter.sourceName, key, hash]))!;
        const existing = await db.get<{ id: number; raw_record_id: number | null }>("SELECT id, raw_record_id FROM parking_lots WHERE source_name=? AND source_record_id=?", [adapter.sourceName, key]);
        if (existing && existing.raw_record_id === raw.id) {
          await db.run("UPDATE parking_lots SET collected_at=?, data_status='ACTIVE', fee_note=?, quality_flags=? WHERE id=?", [startedAt, lot.feeNote, JSON.stringify(lot.qualityFlags), existing.id]);
          sum.unchanged++; continue;
        }
        const flags = JSON.stringify(lot.qualityFlags);
        let id: number;
        if (existing) {
          id = existing.id;
          await db.run(`UPDATE parking_lots SET name=?, operator_name=?, parking_type=?, ownership_type=?, address=?, road_address=?, latitude=?, longitude=?, total_spaces=?, phone=?, fee_note=?,
            source_updated_at=?, collected_at=?, data_status='ACTIVE', quality_flags=?, updated_at=?, raw_record_id=? WHERE id=?`,
            [lot.name, lot.operatorName, lot.parkingType, lot.ownershipType, lot.address, lot.roadAddress, lot.latitude, lot.longitude, lot.totalSpaces, lot.phone, lot.feeNote, lot.sourceUpdatedAt, startedAt, flags, startedAt, raw.id, id]);
          await db.run("DELETE FROM fee_rules WHERE parking_lot_id=?", [id]);
          await db.run("DELETE FROM operating_schedules WHERE parking_lot_id=?", [id]);
          sum.updated++;
        } else {
          await db.run(`INSERT INTO parking_lots(source_name, source_record_id, name, operator_name, parking_type, ownership_type, address, road_address, latitude, longitude, total_spaces, phone, fee_note,
            source_updated_at, collected_at, data_status, quality_flags, created_at, updated_at, raw_record_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?)`,
            [adapter.sourceName, key, lot.name, lot.operatorName, lot.parkingType, lot.ownershipType, lot.address, lot.roadAddress, lot.latitude, lot.longitude, lot.totalSpaces, lot.phone, lot.feeNote, lot.sourceUpdatedAt, startedAt, flags, startedAt, startedAt, raw.id]);
          id = (await db.get<{ id: number }>("SELECT id FROM parking_lots WHERE source_name=? AND source_record_id=?", [adapter.sourceName, key]))!.id;
          sum.inserted++;
        }
        for (const f of lot.feeRules) {
          await db.run(`INSERT INTO fee_rules(parking_lot_id, rule_type, amount, duration_minutes, valid_day_type, daily_max_basis, free_flag, source_record_id, verified_at) VALUES (?,?,?,?,?,?,?,?,?)`,
            [id, f.ruleType, f.amount, f.durationMinutes, f.dayType, f.dailyMaxBasis, f.ruleType === "FREE" ? 1 : null, key, lot.sourceUpdatedAt]);
        }
        for (const sc of lot.schedules) {
          await db.run(`INSERT INTO operating_schedules(parking_lot_id, day_type, open_time, close_time, all_day_flag, closed_flag, holiday_policy, source_record_id, verified_at) VALUES (?,?,?,?,?,0,?,?,?)`,
            [id, sc.dayType, sc.openTime, sc.closeTime, sc.allDay ? 1 : 0, sc.assumed ? "SUNDAY_ASSUMED" : null, key, lot.sourceUpdatedAt]);
        }
        touched.push(id);
      } catch (e) {
        sum.errors++;
        console.error("[sync] row error", adapter.sourceName, e instanceof Error ? e.message : e);
      }
    }
    });
    // 중복 후보 탐지(자동 병합 없음)
    for (const id of touched) {
      const me = await db.get<{ id: number; name: string; road_address: string | null; latitude: number | null; longitude: number | null }>("SELECT id,name,road_address,latitude,longitude FROM parking_lots WHERE id=?", [id]);
      if (!me || me.latitude == null || me.longitude == null) continue;
      const near = await db.all<{ id: number; name: string; road_address: string | null; latitude: number; longitude: number }>(
        "SELECT id,name,road_address,latitude,longitude FROM parking_lots WHERE id<>? AND data_status NOT LIKE 'EXCLUDED%' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
        [id, me.latitude - 0.0015, me.latitude + 0.0015, me.longitude - 0.0018, me.longitude + 0.0018]);
      for (const o of near) {
        const c = findCandidates({ id: me.id, name: me.name, roadAddress: me.road_address, latitude: me.latitude, longitude: me.longitude },
          { id: o.id, name: o.name, roadAddress: o.road_address, latitude: o.latitude, longitude: o.longitude });
        if (!c) continue;
        const r = await db.run("INSERT OR IGNORE INTO duplicate_candidates(lot_a_id, lot_b_id, score, reason, status, created_at) VALUES (?,?,?,?, 'PENDING', ?)", [c.lotA, c.lotB, c.score, c.reason, startedAt]);
        sum.duplicateCandidates += r.changes;
      }
    }
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
    console.error("[sync] fatal", adapter.sourceName, fatal);
  }
  sum.status = fatal ? "FAILED" : sum.errors > 0 || sum.invalid > 0 ? "PARTIAL" : "SUCCESS";
  await db.run("UPDATE source_sync_logs SET finished_at=?, status=?, records_received=?, records_inserted=?, records_updated=?, error_summary=?, source_data_timestamp=? WHERE id=?",
    [finishedIso(now, t0), sum.status, sum.received, sum.inserted, sum.updated,
      fatal ? "원천 수집 실패(상세는 서버 로그)" : sum.errors || sum.invalid ? `행 오류 ${sum.errors}건, 형식 불량 ${sum.invalid}건` : null, newestBase, logId]);
  return sum;
}
