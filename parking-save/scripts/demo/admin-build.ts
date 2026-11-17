// 정적 데모용 관리자 화면 빌드: 수집된 DB의 실제 집계(시설·요금·품질·중복·수집 이력) + 예시 운영 데이터 → 단일 HTML.
// 사용: tsx scripts/demo/admin-build.ts --db ./data/dev.sqlite --out ./data/demo/admin.html
// 서버가 없는 데모라 이용 통계·신고는 '예시'로 표시하고, 처리 버튼은 이 화면 안에서만 동작한다(저장 안 됨).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { STANDARD_SOURCE } from "../../src/collector/standard-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const dbPath = arg("db", process.env.DATABASE_PATH || "./data/dev.sqlite"), outPath = arg("out", "./data/demo/admin.html");
const db = new DatabaseSync(dbPath, { readOnly: true });
type Row = Record<string, unknown>;
const all = (sql: string, ...p: Array<string | number>) => db.prepare(sql).all(...p) as Row[];
const num = (sql: string, ...p: Array<string | number>) => Number((db.prepare(sql).get(...p) as Row | undefined)?.c ?? 0);
const S = STANDARD_SOURCE, LIVE = "source_name = ? AND data_status NOT LIKE 'EXCLUDED%'";

const total = num(`SELECT COUNT(*) c FROM parking_lots WHERE ${LIVE}`, S);
const has = (type: string) => num(`SELECT COUNT(DISTINCT f.parking_lot_id) c FROM fee_rules f JOIN parking_lots l ON l.id=f.parking_lot_id WHERE l.${LIVE} AND f.rule_type=?`, S, type);
const flagCounts = new Map<string, number>();
for (const r of all(`SELECT quality_flags q FROM parking_lots WHERE ${LIVE} AND quality_flags IS NOT NULL`, S))
  for (const f of JSON.parse(String(r.q)) as string[]) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
const sido = new Map<string, number>();
for (const r of all(`SELECT COALESCE(road_address, address) a FROM parking_lots WHERE ${LIVE}`, S)) { const k = String(r.a ?? "").trim().split(/\s+/)[0] || "주소 없음"; sido.set(k, (sido.get(k) ?? 0) + 1); }
const data = {
  collected: (db.prepare("SELECT MAX(finished_at) c FROM source_sync_logs WHERE source_name=? AND status IN ('SUCCESS','PARTIAL')").get(S) as Row | undefined)?.c ?? null,
  total, noCoord: num(`SELECT COUNT(*) c FROM parking_lots WHERE ${LIVE} AND (latitude IS NULL OR longitude IS NULL)`, S),
  fee: { free: has("FREE"), base: has("BASE"), dailyMax: has("DAILY_MAX"), pass: has("SEASON_PASS"),
    none: num(`SELECT COUNT(*) c FROM parking_lots l WHERE ${LIVE} AND NOT EXISTS (SELECT 1 FROM fee_rules f WHERE f.parking_lot_id=l.id AND f.rule_type<>'SEASON_PASS')`, S) },
  sched: num(`SELECT COUNT(DISTINCT o.parking_lot_id) c FROM operating_schedules o JOIN parking_lots l ON l.id=o.parking_lot_id WHERE l.${LIVE}`, S),
  flags: [...flagCounts].sort((a, b) => b[1] - a[1]).slice(0, 8),
  sido: [...sido].sort((a, b) => b[1] - a[1]).slice(0, 17),
  dup: { pending: num("SELECT COUNT(*) c FROM duplicate_candidates WHERE status='PENDING'"), merged: num("SELECT COUNT(*) c FROM duplicate_candidates WHERE status='MERGED'"),
    sample: all(`SELECT d.id, a.name an, a.road_address aa, b.name bn, b.road_address ba, d.score FROM duplicate_candidates d JOIN parking_lots a ON a.id=d.lot_a_id JOIN parking_lots b ON b.id=d.lot_b_id WHERE d.status='PENDING' ORDER BY d.score DESC, d.id LIMIT 6`) },
  syncs: all("SELECT source_name s, status st, started_at t, finished_at f, records_received r, records_inserted i, error_summary e FROM source_sync_logs ORDER BY id DESC LIMIT 6"),
  lots: all(`SELECT id, name, COALESCE(road_address, address) a FROM parking_lots WHERE ${LIVE} AND latitude IS NOT NULL ORDER BY total_spaces DESC LIMIT 5`, S),
};
const html = fs.readFileSync(path.join(here, "admin.html"), "utf8").replace("/*DATA*/", () => JSON.stringify(data).replace(/</g, "\\u003c"));
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(JSON.stringify({ out: outPath, bytes: Buffer.byteLength(html), total: data.total, fee: data.fee, dup: { pending: data.dup.pending }, flags: data.flags.length }));
