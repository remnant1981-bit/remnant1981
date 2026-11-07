// DB 추상화: 서버 코드는 이 인터페이스만 사용(파라미터 바인딩 전용).
// 로컬/테스트: node:sqlite. Cloudflare D1: createD1Db(env.DB) 어댑터 사용(배포 시 연결, docs/DEPLOYMENT.md 참고).
import fs from "node:fs";
import path from "node:path";

export type SqlValue = string | number | null;

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

/** Cloudflare D1 바인딩 어댑터(배포 환경 전용, 로컬에서는 미검증). */
export interface D1LikeDb {
  prepare(sql: string): {
    bind(...v: SqlValue[]): {
      all(): Promise<{ results: unknown[] }>;
      first(): Promise<unknown>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
  exec(sql: string): Promise<unknown>;
}
export function createD1Db(d1: D1LikeDb): Db {
  return {
    async all(sql, params = []) {
      return ((await d1.prepare(sql).bind(...params).all()).results ?? []) as never;
    },
    async get(sql, params = []) {
      return ((await d1.prepare(sql).bind(...params).first()) ?? undefined) as never;
    },
    async run(sql, params = []) {
      return { changes: (await d1.prepare(sql).bind(...params).run()).meta.changes };
    },
    async exec(sql) {
      await d1.exec(sql);
    },
  };
}

export async function createSqliteDb(file: string): Promise<Db> {
  // node:sqlite 는 실험 기능 경고를 출력하므로 동적 import
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = " + (file === ":memory:" ? "MEMORY" : "WAL") + ";");
  return {
    async all(sql, params = []) {
      return raw.prepare(sql).all(...params).map((r) => ({ ...r })) as never; // null-prototype → 일반 객체
    },
    async get(sql, params = []) {
      const r = raw.prepare(sql).get(...params);
      return (r ? { ...r } : undefined) as never;
    },
    async run(sql, params = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };
}

export async function migrate(db: Db, dir = path.resolve(process.cwd(), "migrations")): Promise<string[]> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((await db.all<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    await db.run("INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)", [f, new Date().toISOString()]);
    applied.push(f);
  }
  return applied;
}

let cached: Promise<Db> | undefined;
/** 요청 처리용 싱글턴 DB. 테스트에서는 setDb 로 교체. */
export function getDb(): Promise<Db> {
  if (!cached) {
    cached = (async () => {
      const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
      await migrate(db);
      return db;
    })();
  }
  return cached;
}
export function setDb(db: Db | undefined) {
  cached = db ? Promise.resolve(db) : undefined;
}
