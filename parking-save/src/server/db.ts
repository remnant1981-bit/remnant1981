// DB 추상화: 서버 코드는 이 인터페이스만 사용(파라미터 바인딩 전용).
// 로컬/테스트: node:sqlite. Cloudflare D1: createD1Db(env.DB) 어댑터 사용(배포 시 연결, docs/DEPLOYMENT.md 참고).
import fs from "node:fs";
import path from "node:path";

export type SqlValue = string | number | null;

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastId: number }>;
  exec(sql: string): Promise<void>;
  /**
   * 여러 쓰기를 한 번에 커밋(대량 적재 속도). SQLite: 단일 연결에서 직렬화된 BEGIN/COMMIT, 실패 시 ROLLBACK 후 재던짐.
   * D1: 트랜잭션 API가 없어 그냥 실행(원자성 없음 — 호출부는 원자성에 의존하지 말 것).
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Cloudflare D1 바인딩 어댑터(배포 환경 전용, 로컬에서는 미검증). */
export interface D1LikeDb {
  prepare(sql: string): {
    bind(...v: SqlValue[]): {
      all(): Promise<{ results: unknown[] }>;
      first(): Promise<unknown>;
      run(): Promise<{ meta: { changes: number; last_row_id?: number } }>;
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
      const { meta } = await d1.prepare(sql).bind(...params).run();
      return { changes: meta.changes, lastId: Number(meta.last_row_id ?? 0) };
    },
    async exec(sql) {
      await d1.exec(sql);
    },
    transaction: (fn) => fn(),
  };
}

export async function createSqliteDb(file: string): Promise<Db> {
  // node:sqlite 는 실험 기능 경고를 출력하므로 동적 import
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  let depth = 0, txChain: Promise<void> = Promise.resolve();
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
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async exec(sql) {
      raw.exec(sql);
    },
    async transaction(fn) {
      if (depth > 0) return fn(); // 이미 트랜잭션 안(중첩은 바깥에 합류)
      const prev = txChain;
      let release!: () => void;
      txChain = new Promise<void>((r) => (release = r));
      await prev; // 다른 트랜잭션이 끝날 때까지 대기(단일 연결)
      depth++;
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn();
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        try { raw.exec("ROLLBACK"); } catch { /* 이미 종료 */ }
        throw e;
      } finally {
        depth--;
        release();
      }
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
