// DB 상태 점검(헬스체크·관리자 점검·백업 복원 리허설 공용 기준).
// 헬스체크는 가벼운 항목만(마이그레이션 적용 수·마지막 수집), 무결성 검사는 관리자 점검/백업 스크립트에서만 실행한다.
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";

export function expectedMigrations(dir = path.resolve(process.cwd(), "migrations")): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort(); } catch { return []; }
}

export interface SchemaState { applied: number; expected: number; missing: string[] }
export async function schemaState(db: Db, dir?: string): Promise<SchemaState> {
  const exp = expectedMigrations(dir);
  const done = new Set((await db.all<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  return { applied: done.size, expected: exp.length, missing: exp.filter((f) => !done.has(f)) };
}

/** 표준데이터 마지막 성공 수집이 이 시간보다 오래되면 'degraded' — 일 1회 수집 + 실패 하루 여유 */
export const SYNC_STALE_HOURS = 50;

export interface DeepCheck { integrity: string[]; foreignKeyViolations: number; lots: number; liveLots: number; feeRules: number; schema: SchemaState }
/** 무결성 전체 검사(수 초 걸릴 수 있음 — 관리자 점검에서만) */
export async function deepCheck(db: Db, dir?: string): Promise<DeepCheck> {
  const integrity = (await db.all<{ integrity_check: string }>("PRAGMA integrity_check")).map((r) => r.integrity_check);
  const fk = await db.all("PRAGMA foreign_key_check");
  const c = async (sql: string) => Number((await db.get<{ c: number }>(sql))?.c ?? 0);
  return {
    integrity, foreignKeyViolations: fk.length,
    lots: await c("SELECT COUNT(*) AS c FROM parking_lots"),
    liveLots: await c("SELECT COUNT(*) AS c FROM parking_lots WHERE data_status NOT LIKE 'EXCLUDED%'"),
    feeRules: await c("SELECT COUNT(*) AS c FROM fee_rules"),
    schema: await schemaState(db, dir),
  };
}
export const deepCheckOk = (d: DeepCheck) => d.integrity.length === 1 && d.integrity[0] === "ok" && d.foreignKeyViolations === 0 && d.schema.missing.length === 0;
