import bcrypt from "bcryptjs";
import { newId, randomToken, sha256Hex, timingSafeEqual, hmacHex } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import type { Db } from "./db";

export const SESSION_COOKIE = "gbf_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface User { id: string; email: string; role: "user" | "admin"; status: string }
export interface SessionCtx { user: User; sessionId: string; csrf: string }

const cost = () => Number(process.env.BCRYPT_COST || 12);
// 존재하지 않는 계정에도 동일한 해시 비교 시간을 쓰기 위한 더미 해시(계정 열거 완화)
let dummyHash: string | undefined;
async function dummy(): Promise<string> {
  return (dummyHash ??= await bcrypt.hash("dummy-password-for-timing", cost()));
}

export function normalizeEmail(e: string): string | null {
  const v = e.trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}
export function validatePassword(p: string): string | null {
  if (p.length < 10) return "비밀번호는 10자 이상이어야 합니다.";
  if (p.length > 72) return "비밀번호는 72자 이하여야 합니다.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "비밀번호는 영문과 숫자를 모두 포함해야 합니다.";
  return null;
}

/** 간단한 고정 윈도우 rate limit (D1/SQLite 호환). */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number): Promise<void> {
  const k = await hmacHex("APP_SESSION_PEPPER", key); // 키에 이메일/IP 평문 저장 방지
  const now = Math.floor(Date.now() / 1000);
  const row = await db.get<{ count: number; window_start: number }>("SELECT count, window_start FROM rate_limits WHERE key=?", [k]);
  if (!row || now - row.window_start >= windowSec) {
    await db.run("INSERT INTO rate_limits(key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=1, window_start=excluded.window_start", [k, now]);
    return;
  }
  if (row.count >= limit) throw new ApiError(429, "rate_limited", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  await db.run("UPDATE rate_limits SET count=count+1 WHERE key=?", [k]);
}

async function sessionKey(token: string): Promise<string> {
  return hmacHex("APP_SESSION_PEPPER", "session:" + token);
}

export async function createSession(db: Db, userId: string) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  await db.run("INSERT INTO sessions(id,user_id,csrf_token,created_at,expires_at) VALUES (?,?,?,?,?)",
    [await sessionKey(token), userId, csrf, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()]);
  return { token, csrf, maxAge: SESSION_TTL_MS / 1000 };
}

export function sessionCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function clearCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function getSession(db: Db, cookieHeader: string | null): Promise<SessionCtx | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token || token.length < 20) return null;
  const id = await sessionKey(token);
  const row = await db.get<{ user_id: string; csrf_token: string; expires_at: string; email: string; role: "user" | "admin"; status: string }>(
    "SELECT s.user_id, s.csrf_token, s.expires_at, u.email, u.role, u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?", [id]);
  if (!row) return null;
  if (row.expires_at < nowIso() || row.status !== "active") {
    await db.run("DELETE FROM sessions WHERE id=?", [id]);
    return null;
  }
  return { user: { id: row.user_id, email: row.email, role: row.role, status: row.status }, sessionId: id, csrf: row.csrf_token };
}

export async function destroySession(db: Db, cookieHeader: string | null) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (token) await db.run("DELETE FROM sessions WHERE id=?", [await sessionKey(token)]);
}

/** 가입: 이메일 중복이어도 동일 응답(계정 열거 방지). 중복이면 계정/세션을 만들지 않는다. */
export async function register(db: Db, emailRaw: string, password: string, ipKey: string) {
  await rateLimit(db, `register:${ipKey}`, 10, 3600);
  const email = normalizeEmail(emailRaw);
  if (!email) throw new ApiError(400, "invalid_email", "이메일 형식을 확인해 주세요.");
  const pwErr = validatePassword(password);
  if (pwErr) throw new ApiError(400, "weak_password", pwErr);
  const hash = await bcrypt.hash(password, cost());
  const existing = await db.get("SELECT id FROM users WHERE email=?", [email]);
  if (existing) return { created: false as const };
  const id = newId();
  const now = nowIso();
  try {
    await db.run("INSERT INTO users(id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,'user','active',?,?)", [id, email, hash, now, now]);
  } catch {
    return { created: false as const }; // 동시 가입 경쟁
  }
  return { created: true as const, userId: id, session: await createSession(db, id) };
}

export async function login(db: Db, emailRaw: string, password: string, ipKey: string) {
  const email = normalizeEmail(emailRaw) ?? "invalid";
  await rateLimit(db, `login-ip:${ipKey}`, 30, 600);
  await rateLimit(db, `login-email:${email}`, 10, 600);
  const generic = new ApiError(401, "invalid_credentials", "이메일 또는 비밀번호를 확인해 주세요.");
  const user = await db.get<{ id: string; password_hash: string; status: string; failed_logins: number; locked_until: string | null }>(
    "SELECT id,password_hash,status,failed_logins,locked_until FROM users WHERE email=?", [email]);
  if (!user) {
    await bcrypt.compare(password, await dummy());
    throw generic;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (user.locked_until && user.locked_until > nowIso()) throw generic; // 잠금 중에는 성공 여부 노출하지 않음
  if (!ok || user.status !== "active") {
    const fails = user.failed_logins + 1;
    await db.run("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?",
      [fails, fails >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null, user.id]);
    throw generic;
  }
  await db.run("UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=? WHERE id=?", [nowIso(), user.id]);
  await db.run("DELETE FROM sessions WHERE user_id=? AND expires_at<?", [user.id, nowIso()]);
  return { userId: user.id, session: await createSession(db, user.id) }; // 로그인마다 새 세션(고정 방지)
}

/** CSRF: 상태 변경 요청은 Origin(동일 출처) + 세션 CSRF 토큰 헤더를 모두 요구. */
export async function verifyCsrf(req: Request, session: SessionCtx | null) {
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host") ?? new URL(req.url).host;
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { ok = false; }
    if (!ok) throw new ApiError(403, "csrf_origin", "허용되지 않은 요청 출처입니다.");
  } else if (process.env.NODE_ENV === "production") {
    throw new ApiError(403, "csrf_origin", "허용되지 않은 요청 출처입니다.");
  }
  if (session) {
    const t = req.headers.get("x-csrf-token") ?? "";
    if (!t || !timingSafeEqual(t, session.csrf)) throw new ApiError(403, "csrf_token", "요청 검증에 실패했습니다. 페이지를 새로고침해 주세요.");
  }
}

export { sha256Hex };
