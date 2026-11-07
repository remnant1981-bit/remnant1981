import { getDb, type Db } from "./db";
import { ApiError, getSession, verifyCsrf, type SessionCtx } from "./auth";
import { logError } from "@/lib/log";

export interface Ctx { db: Db; session: SessionCtx | null; ip: string }

export function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "local").trim().slice(0, 64);
}

export function json(data: unknown, init: ResponseInit & { cookie?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  if (init.cookie) headers.append("Set-Cookie", init.cookie);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 100_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "too_large", "요청이 너무 큽니다.");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new ApiError(400, "bad_json", "요청 형식이 올바르지 않습니다.");
  }
}

type Auth = "none" | "user" | "admin";
interface Opts { auth?: Auth; csrf?: boolean }

/** 공통 라우트 래퍼: 인증/관리자 권한/CSRF 검사와 안전한 오류 응답. 권한은 모든 요청에서 서버가 재검증한다. */
export function route<A extends unknown[]>(opts: Opts, fn: (req: Request, c: Ctx, ...args: A) => Promise<Response | unknown>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      const db = await getDb();
      const session = await getSession(db, req.headers.get("cookie"));
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (opts.csrf ?? mutating) await verifyCsrf(req, opts.auth && opts.auth !== "none" ? session : session);
      if ((opts.auth === "user" || opts.auth === "admin") && !session) throw new ApiError(401, "unauthorized", "로그인이 필요합니다.");
      if (opts.auth === "admin" && session?.user.role !== "admin") throw new ApiError(404, "not_found", "찾을 수 없습니다."); // 관리자 API 존재 노출 최소화
      const out = await fn(req, { db, session, ip: clientIp(req) }, ...args);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, message: e.message }, { status: e.status });
      logError("api error", { path: new URL(req.url).pathname, err: e instanceof Error ? e.message : String(e) });
      return json({ error: "internal", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
  };
}
