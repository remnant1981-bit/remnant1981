// 기업마당 API 실호출 확인(사용자 PC 등 국내 IP에서 실행). 키는 환경변수로만 읽고 출력하지 않는다.
//   Windows(PowerShell): $env:BIZINFO_API_KEY="발급키"; npx tsx scripts/probe-bizinfo.ts
//   macOS/Linux:         BIZINFO_API_KEY=발급키 npx tsx scripts/probe-bizinfo.ts
// 옵션: --save   응답 구조 요약(키 이름·값 타입·짧게 자른 값)을 probe-bizinfo.out.json 으로 저장(공유용, 키 미포함)
//       --collect 임시 DB(data/probe.sqlite)에 최대 30건 수집해 저장·멱등·live 전환까지 확인
import fs from "node:fs";
import { mapItem } from "../src/collector/bizinfo";

const key = process.env.BIZINFO_API_KEY;
if (!key) { console.error("BIZINFO_API_KEY 환경변수가 필요합니다."); process.exit(1); }
const save = process.argv.includes("--save");
const collect = process.argv.includes("--collect");

const short = (v: unknown): unknown => (typeof v === "string" ? (v.length > 40 ? v.slice(0, 40) + "…" : v) : v);
function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return { _array: v.length, first: v.length ? shape(v[0], depth + 1) : null };
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, depth > 3 ? typeof x : shape(x, depth + 1)]));
  return `${typeof v}: ${JSON.stringify(short(v))}`;
}

const u = new URL("https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do");
u.searchParams.set("crtfcKey", key);
u.searchParams.set("dataType", "json");
u.searchParams.set("pageUnit", "2");
u.searchParams.set("pageIndex", "1");

let res: Response;
try { res = await fetch(u, { signal: AbortSignal.timeout(20000) }); }
catch (e) { console.error("호출 실패(네트워크/차단):", (e as Error).name); process.exit(2); }
console.log("HTTP", res.status, res.headers.get("content-type"));
const text = await res.text();
let body: unknown;
try { body = JSON.parse(text); } catch { console.log("JSON 아님. 앞 200자(키 제거):", text.replaceAll(key, "***").slice(0, 200)); process.exit(3); }
const summary = shape(body);
console.log("응답 구조:\n" + JSON.stringify(summary, null, 2));

const o = body as Record<string, unknown>;
const items = (Array.isArray(body) ? body : (["jsonArray", "items", "item", "data", "list"].map((k) => o[k]).find(Array.isArray) as unknown[] | undefined)) ?? [];
console.log(`항목 ${items.length}건 / 어댑터 매핑 결과:`);
for (const it of items as Record<string, unknown>[]) {
  const m = mapItem(it);
  console.log(m ? { id: m.sourceNoticeId, 기관: m.organization, 분야: m.categories, 지역: m.regionScope, 기간: [m.applicationStart, m.applicationEnd], 첨부: m.files?.length } : "매핑 실패(필수 필드 누락)");
}
if (save) { fs.writeFileSync("probe-bizinfo.out.json", JSON.stringify(summary, null, 2)); console.log("저장: probe-bizinfo.out.json (키 미포함, 공유 가능)"); }

if (collect) {
  const { createSqliteDb, migrate } = await import("../src/server/db");
  const { seedReference } = await import("../src/server/seed-data");
  const { runSource } = await import("../src/collector/runner");
  const { BizinfoAdapter } = await import("../src/collector/bizinfo");
  fs.rmSync("data/probe.sqlite", { force: true });
  const db = await createSqliteDb("data/probe.sqlite");
  await migrate(db); await seedReference(db);
  class Limited extends BizinfoAdapter { async fetch() { return (await super.fetch()).slice(0, 30); } }
  const a = new Limited(key, { pageUnit: 30 });
  console.log("1차:", await runSource(db, a, { retries: 0 }));
  console.log("2차(멱등):", await runSource(db, a, { retries: 0 }));
  console.log("source:", await db.get("SELECT integration_status, last_error FROM data_sources WHERE id='bizinfo'"));
}
