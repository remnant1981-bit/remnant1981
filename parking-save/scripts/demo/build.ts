// 정적 데모 페이지 빌드: 수집된 DB → 압축 데이터 + 도메인 엔진 번들 → 단일 HTML(서버 불필요).
// 사용: npm run demo:build -- [--db ./data/dev.sqlite] [--out ./data/demo/parking-save-demo.html]
// - 실서비스 원천(STANDARD_SOURCE)만 포함한다. 목업·샘플 원천은 넣지 않는다.
// - 좌표가 없는 시설은 반경 검색이 불가능해 제외하고 건수만 표시한다.
// - 공휴일은 DB의 holidays/holiday_coverage(가장 넓은 보장 범위 1개)를 넣는다. 없으면 요일별 규칙 시설은 판정 불가로 표시된다.
// - 실시간 잔여면수는 포함하지 않는다(정적 페이지라 신선도를 보장할 수 없음).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { STANDARD_SOURCE } from "../../src/collector/standard-api";
import { NON_PRODUCTION_SOURCES } from "../../src/server/mock";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const dbPath = arg("db", process.env.DATABASE_PATH || "./data/dev.sqlite");
const outPath = arg("out", "./data/demo/parking-save-demo.html");
if (!fs.existsSync(dbPath)) { console.error(`DB 파일이 없습니다: ${dbPath}`); process.exit(1); }

type Row = Record<string, unknown>;
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql: string, ...p: Array<string | number>) => db.prepare(sql).all(...p) as Row[];
const one = (sql: string, ...p: Array<string | number>) => db.prepare(sql).get(...p) as Row | undefined;

const LIVE = "data_status NOT LIKE 'EXCLUDED%'";
const lots = all(`SELECT * FROM parking_lots WHERE source_name = ? AND ${LIVE} AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY id`, STANDARD_SOURCE);
if (lots.length === 0) { console.error(`${STANDARD_SOURCE} 시설이 없습니다. 먼저 표준데이터를 수집하세요(npm run sync:standard).`); process.exit(1); }
const noCoord = Number(one(`SELECT COUNT(*) AS c FROM parking_lots WHERE source_name = ? AND ${LIVE} AND (latitude IS NULL OR longitude IS NULL)`, STANDARD_SOURCE)?.c ?? 0);

const groupBy = (rows: Row[]) => { const m = new Map<number, Row[]>(); for (const r of rows) { const k = Number(r.parking_lot_id); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); } return m; };
const fees = groupBy(all("SELECT * FROM fee_rules WHERE rule_type <> 'SEASON_PASS' ORDER BY id")); // 정기권은 시간제 요금과 무관(앱과 동일)
// 월 정기권 금액(앱과 같이 금액 > 0 인 첫 규칙). 시간제 요금 계산에는 쓰지 않고 장기 이용 안내에만 사용
const passes = new Map<number, number>();
for (const r of all("SELECT parking_lot_id, amount FROM fee_rules WHERE rule_type = 'SEASON_PASS' AND amount > 0 ORDER BY id")) if (!passes.has(Number(r.parking_lot_id))) passes.set(Number(r.parking_lot_id), Number(r.amount));
const scheds = groupBy(all("SELECT * FROM operating_schedules ORDER BY id"));

// 같은 규칙·일정·플래그 묶음이 많아 사전으로 중복 제거(전국 약 1.6만 곳 → 규칙 묶음 수백 개)
const dict = () => { const m = new Map<string, number>(); const arr: unknown[] = []; return { arr, idx(v: unknown) { const k = JSON.stringify(v); if (!m.has(k)) { m.set(k, arr.length); arr.push(v); } return m.get(k)!; } }; };
const R = dict(), S = dict(), F = dict();
const pos = new Map<number, number>();
const L = lots.map((l, i) => {
  pos.set(Number(l.id), i);
  const rules = (fees.get(Number(l.id)) ?? []).map((r) => [r.rule_type, r.amount, r.duration_minutes, r.valid_day_type, r.start_time, r.end_time, r.daily_max_basis]);
  const sc = (scheds.get(Number(l.id)) ?? []).map((s) => [s.day_type, s.open_time, s.close_time, s.all_day_flag === 1 ? 1 : 0, s.closed_flag === 1 ? 1 : 0, s.holiday_policy === "SUNDAY_ASSUMED" ? 1 : 0]);
  const flags = l.quality_flags ? JSON.parse(String(l.quality_flags)) : [];
  return [l.name, l.road_address ?? l.address, l.parking_type === "OFF_STREET" ? 0 : l.parking_type === "ON_STREET" ? 1 : 2,
    Number(Number(l.latitude).toFixed(6)), Number(Number(l.longitude).toFixed(6)), l.total_spaces, String(l.source_updated_at ?? "").slice(0, 10) || null,
    R.idx(rules), S.idx(sc), F.idx(flags), l.fee_note ?? null, l.ownership_type === "PUBLIC" ? 1 : 0, l.operator_name ?? null, l.phone ?? null, passes.get(Number(l.id)) ?? null];
});
// 동일 시설 후보: 승인(MERGED) 또는 점수 1.0 PENDING (앱 검색 묶음 기준과 동일)
const dup = all("SELECT lot_a_id AS a, lot_b_id AS b, status FROM duplicate_candidates WHERE status = 'MERGED' OR (status = 'PENDING' AND score >= 1.0)")
  .filter((x) => pos.has(Number(x.a)) && pos.has(Number(x.b))).map((x) => [pos.get(Number(x.a)), pos.get(Number(x.b)), x.status === "MERGED" ? 1 : 0]);
const collected = (one("SELECT MAX(finished_at) AS t FROM source_sync_logs WHERE source_name = ? AND status IN ('SUCCESS','PARTIAL')", STANDARD_SOURCE)?.t as string | undefined) ?? null;

// 목업 원천의 가상 공휴일 커버리지는 제외(개발 DB로 빌드해도 목업 공휴일이 섞이지 않게)
const cov = one(`SELECT source_name, from_date, to_date FROM holiday_coverage WHERE source_name NOT IN (${NON_PRODUCTION_SOURCES.map(() => "?").join(",")}) ORDER BY to_date DESC, from_date ASC LIMIT 1`, ...NON_PRODUCTION_SOURCES);
const holidays = cov ? {
  source: String(cov.source_name), from: String(cov.from_date), to: String(cov.to_date),
  dates: all("SELECT DISTINCT date FROM holidays WHERE source_name = ? AND date BETWEEN ? AND ? ORDER BY date", String(cov.source_name), String(cov.from_date), String(cov.to_date)).map((r) => String(r.date)),
} : null;

const data = { v: 1, source: "전국주차장정보표준데이터 (공공데이터포털)", collected, noCoord, holidays, rules: R.arr, scheds: S.arr, flags: F.arr, lots: L, dup };

const bundle = await build({ entryPoints: [path.join(here, "engine.ts")], bundle: true, format: "iife", globalName: "PS", minify: true, target: "es2020", write: false, logLevel: "silent" });
const engine = bundle.outputFiles[0].text;
if (/<\/script/i.test(engine)) throw new Error("엔진 번들에 </script 문자열이 있어 인라인할 수 없습니다");
const json = JSON.stringify(data).replace(/</g, "\\u003c"); // 데이터 안의 '<'가 script 태그를 닫지 않도록
const html = fs.readFileSync(path.join(here, "template.html"), "utf8").replace("/*ENGINE*/", () => engine).replace("/*DATA*/", () => json);

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(JSON.stringify({ out: outPath, bytes: Buffer.byteLength(html), lots: L.length, noCoord, ruleSets: R.arr.length, passes: L.filter((x) => x[14] != null).length, scheduleSets: S.arr.length, duplicates: dup.length, collected, holidays: holidays && { source: holidays.source, from: holidays.from, to: holidays.to, days: holidays.dates.length } }));
