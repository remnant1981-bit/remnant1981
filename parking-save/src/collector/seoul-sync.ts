// 서울 시영주차장 실시간 주차대수 수집·저장·시설 연결 후보 생성.
// 응답에 좌표가 없으므로 이 원천의 시설은 검색에 직접 노출되지 않는다(NO_COORDS_BY_DESIGN).
// 표준데이터 시설과 '주소 일치'로 연결 후보(duplicate_candidates)를 만들고, 관리자가 승인(MERGED)한 경우에만 실시간 값을 사용한다.
import { createHash } from "node:crypto";
import type { Db } from "@/server/db";
import { finishedIso } from "@/lib/time";
import { SEOUL_SOURCE, SeoulApiError, parseSeoulResponse, seoulOccupancy, type SeoulRow } from "./seoul-parking";

export const SEOUL_DEFAULT_BASE = "http://openapi.seoul.go.kr:8088"; // 문서 예시는 http. https 지원 여부 미확인 → 환경변수로 변경 가능
const PAGE = 1000;                // 문서: 1회 최대 1000건
const SNAPSHOT_RETENTION_DAYS = 2;

export type PageFetcher = (start: number, end: number) => Promise<string>;

/** 인증키는 URL 경로에 들어간다 → URL·키를 오류/로그에 절대 포함하지 않는다 */
export function seoulPageFetcher(opts: { key: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): PageFetcher {
  const f = opts.fetchImpl ?? fetch;
  return async (start, end) => {
    const url = `${opts.baseUrl ?? SEOUL_DEFAULT_BASE}/${encodeURIComponent(opts.key)}/json/GetParkingInfo/${start}/${end}/`;
    let res: Response;
    try { res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) }); }
    catch { throw new SeoulApiError("NETWORK", "원천 연결 실패"); }
    if (!res.ok) throw new SeoulApiError(`HTTP_${res.status}`, "원천 HTTP 오류");
    return res.text();
  };
}

/** '시·도' 생략된 서울 주소와 표준데이터 지번주소를 같은 키로: `구|동|본번[-부번]` (부번 0 제거). 해석 불가면 null */
export function seoulAddressKey(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const s = addr.replace(/서울특별시|서울시|서울/g, " ").replace(/번지/g, "").replace(/\s+/g, " ").trim();
  const m = /([가-힣]+구)\s+([가-힣0-9]+)\s+(?:산\s*)?(\d+)(?:-(\d+))?/.exec(s);
  if (!m) return null;
  const sub = m[4] && Number(m[4]) > 0 ? `-${Number(m[4])}` : "";
  return `${m[1]}|${m[2]}|${Number(m[3])}${sub}`;
}

const nameKey = (n: string) => n.replace(/\(.*?\)/g, "").replace(/공영주차장|주차장|\s/g, "").toLowerCase();

export function linkScore(a: { name: string; addressKey: string | null; totalSpaces: number | null }, b: { name: string; addressKey: string | null; totalSpaces: number | null }): { score: number; reason: string } | null {
  if (!a.addressKey || a.addressKey !== b.addressKey) return null; // 주소 일치가 필수 조건
  let score = 0.7; const why = [`지번 주소 일치(${a.addressKey})`];
  const na = nameKey(a.name), nb = nameKey(b.name);
  if (na && na === nb) { score += 0.2; why.push("시설명 일치"); }
  else if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) { score += 0.1; why.push("시설명 부분 일치"); }
  if (a.totalSpaces != null && a.totalSpaces === b.totalSpaces) { score += 0.1; why.push("주차면수 일치"); }
  return { score: Math.min(1, Number(score.toFixed(2))), reason: why.join(", ") };
}

export interface SeoulSyncSummary {
  status: "SUCCESS" | "PARTIAL" | "FAILED"; received: number; lots: number; snapshots: number;
  unavailable: Record<string, number>; newCandidates: number;
}

export async function syncSeoulOccupancy(db: Db, fetchPage: PageFetcher, now = new Date()): Promise<SeoulSyncSummary> {
  const startedAt = now.toISOString();
  const sum: SeoulSyncSummary = { status: "SUCCESS", received: 0, lots: 0, snapshots: 0, unavailable: {}, newCandidates: 0 };
  const t0 = performance.now();
  const logId = (await db.run("INSERT INTO source_sync_logs(source_name, started_at, status) VALUES (?,?, 'RUNNING')", [SEOUL_SOURCE, startedAt])).lastId;
  let fatal: string | null = null, newestObserved: string | null = null;
  try {
    const rows: SeoulRow[] = [];
    for (let start = 1; ; start += PAGE) {
      const { rows: page, totalCount } = parseSeoulResponse(await fetchPage(start, start + PAGE - 1));
      rows.push(...page);
      if (page.length < PAGE || rows.length >= totalCount) break;
    }
    sum.received = rows.length;
    const lotIds: number[] = [];
    for (const row of rows) {
      const occ = seoulOccupancy(row);
      const id = String(row.PKLT_CD ?? "").trim();
      if (!id) { sum.unavailable.NO_ID = (sum.unavailable.NO_ID ?? 0) + 1; continue; }
      const total = Number(row.TPKCT);
      const totalSpaces = Number.isInteger(total) && total > 0 ? total : null;
      const typeCode = String(row.PKLT_TYPE ?? "").trim();
      const parkingType = typeCode === "NW" ? "OFF_STREET" : "UNKNOWN"; // 확인된 코드: NW=노외 주차장. 그 외 코드 의미는 미확인
      const flags = JSON.stringify(["NO_COORDS_BY_DESIGN", ...(parkingType === "UNKNOWN" ? [`PKLT_TYPE_UNMAPPED:${typeCode || "-"}`] : [])]);
      const observed = occ.status === "OK" ? occ.observedAt : null;
      if (observed && (!newestObserved || observed > newestObserved)) newestObserved = observed;
      const existing = await db.get<{ id: number }>("SELECT id FROM parking_lots WHERE source_name=? AND source_record_id=?", [SEOUL_SOURCE, id]);
      const ident = JSON.stringify([row.PKLT_CD, row.PKLT_NM, row.ADDR, row.PKLT_TYPE, row.TPKCT]);
      const hash = createHash("sha256").update(ident).digest("hex");
      // 원문은 식별 정보가 바뀔 때만 보존(점유 수치는 5분마다 바뀌므로 원문 이력으로 쌓지 않는다)
      await db.run("INSERT OR IGNORE INTO source_raw_records(source_name, source_record_id, payload_json, payload_hash, source_updated_at, collected_at) VALUES (?,?,?,?,?,?)",
        [SEOUL_SOURCE, id, JSON.stringify(row), hash, observed, startedAt]);
      const raw = (await db.get<{ id: number }>("SELECT id FROM source_raw_records WHERE source_name=? AND source_record_id=? AND payload_hash=?", [SEOUL_SOURCE, id, hash]))!;
      let lotId: number;
      if (existing) {
        lotId = existing.id;
        await db.run(`UPDATE parking_lots SET name=?, address=?, parking_type=?, ownership_type='PUBLIC', total_spaces=?, phone=?, source_updated_at=?, collected_at=?, data_status='ACTIVE', quality_flags=?, updated_at=?, raw_record_id=? WHERE id=?`,
          [String(row.PKLT_NM ?? "").trim() || id, nz(row.ADDR), parkingType, totalSpaces, nz(row.TELNO), observed, startedAt, flags, startedAt, raw.id, lotId]);
      } else {
        await db.run(`INSERT INTO parking_lots(source_name, source_record_id, name, operator_name, parking_type, ownership_type, address, latitude, longitude, total_spaces, phone, source_updated_at, collected_at, data_status, quality_flags, created_at, updated_at, raw_record_id)
          VALUES (?,?,?,?,?,'PUBLIC',?,NULL,NULL,?,?,?,?,'ACTIVE',?,?,?,?)`,
          [SEOUL_SOURCE, id, String(row.PKLT_NM ?? "").trim() || id, "서울특별시", parkingType, nz(row.ADDR), totalSpaces, nz(row.TELNO), observed, startedAt, flags, startedAt, startedAt, raw.id]);
        lotId = (await db.get<{ id: number }>("SELECT id FROM parking_lots WHERE source_name=? AND source_record_id=?", [SEOUL_SOURCE, id]))!.id;
      }
      lotIds.push(lotId); sum.lots++;
      if (occ.status === "OK") {
        await db.run("INSERT INTO occupancy_snapshots(parking_lot_id,total_spaces,available_spaces,occupied_spaces,observed_at,collected_at,source_name,validity_status) VALUES (?,?,?,?,?,?,?,'OK')",
          [lotId, occ.totalSpaces, occ.availableSpaces, occ.occupiedSpaces, occ.observedAt, startedAt, SEOUL_SOURCE]);
        sum.snapshots++;
      } else sum.unavailable[occ.reason] = (sum.unavailable[occ.reason] ?? 0) + 1;
    }
    await db.run("DELETE FROM occupancy_snapshots WHERE source_name=? AND collected_at < ?", [SEOUL_SOURCE, new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 86400_000).toISOString()]);
    sum.newCandidates = await generateLinkCandidates(db, lotIds, startedAt);
  } catch (e) {
    fatal = e instanceof SeoulApiError ? `API_${e.code}` : "UNKNOWN_ERROR";
    console.error("[seoul-sync] failed:", fatal);
  }
  sum.status = fatal ? "FAILED" : Object.keys(sum.unavailable).length > 0 ? "PARTIAL" : "SUCCESS";
  await db.run("UPDATE source_sync_logs SET finished_at=?, status=?, records_received=?, records_inserted=?, error_summary=?, source_data_timestamp=? WHERE id=?",
    [finishedIso(now, t0), sum.status, sum.received, sum.snapshots, fatal ? `서울 수집 실패 ${fatal}` : sum.status === "PARTIAL" ? `현재 주차대수 사용 불가 ${JSON.stringify(sum.unavailable)}` : null, newestObserved, logId]);
  return sum;
}

const nz = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** 서울 시설 ↔ 다른 원천 시설 연결 후보. 자동 연결하지 않으며, 이미 후보/결정이 있는 쌍은 건드리지 않는다 */
async function generateLinkCandidates(db: Db, seoulLotIds: number[], at: string): Promise<number> {
  let created = 0;
  for (const sid of seoulLotIds) {
    const s = await db.get<{ id: number; name: string; address: string | null; total_spaces: number | null }>("SELECT id,name,address,total_spaces FROM parking_lots WHERE id=?", [sid]);
    const sKey = seoulAddressKey(s?.address);
    if (!s || !sKey) continue;
    const gu = sKey.split("|")[0];
    const others = await db.all<{ id: number; name: string; address: string | null; road_address: string | null; total_spaces: number | null }>(
      `SELECT id,name,address,road_address,total_spaces FROM parking_lots WHERE source_name<>? AND data_status NOT LIKE 'EXCLUDED%' AND (address LIKE ? OR road_address LIKE ?)`, [SEOUL_SOURCE, `%${gu}%`, `%${gu}%`]);
    for (const o of others) {
      const r = linkScore({ name: s.name, addressKey: sKey, totalSpaces: s.total_spaces }, { name: o.name, addressKey: seoulAddressKey(o.address), totalSpaces: o.total_spaces });
      if (!r) continue;
      const [a, b] = s.id < o.id ? [s.id, o.id] : [o.id, s.id];
      const ins = await db.run("INSERT OR IGNORE INTO duplicate_candidates(lot_a_id, lot_b_id, score, reason, status, created_at) VALUES (?,?,?,?, 'PENDING', ?)", [a, b, r.score, `서울 실시간 연결 후보: ${r.reason}`, at]);
      created += ins.changes;
    }
  }
  return created;
}
