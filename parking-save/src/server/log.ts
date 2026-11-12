// 구조화 로그(한 줄 JSON → docker logs/journald에서 그대로 수집·검색). 개인정보·비밀값을 남기지 않는다.
// - 좌표·검색어·토큰·인증키는 기록하지 않는다(SECURITY_PRIVACY.md). 오류 메시지 안의 serviceKey 등도 가린다.
// - 최근 오류 수를 메모리에 집계해 헬스체크에서 보여준다(서버 1대 전제, 재시작 시 초기화).

type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

/** 로그에 남기면 안 되는 값(쿼리 문자열 비밀값·Bearer 토큰·좌표 쌍) */
const SECRET_RE = [
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, // 먼저: "Authorization: Bearer x"에서 토큰까지 가리도록
  /((?:service_?key|api_?key|token|authorization|password|secret)["'=:\s]+)(?!Bearer\s)[^\s&"',}]+/gi,
];
const COORD_RE = /\b(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\b/g;
const BLOCKED_FIELDS = new Set(["lat", "lng", "latitude", "longitude", "destination", "token", "serviceKey", "query"]);

export function redact(s: string): string {
  let out = s;
  for (const re of SECRET_RE) out = out.replace(re, "$1[REDACTED]");
  return out.replace(COORD_RE, "[COORD]").slice(0, 2000);
}

const errorTimes: number[] = [];
const WINDOW_MS = 5 * 60_000;
function noteError(now: number) {
  errorTimes.push(now);
  while (errorTimes.length && errorTimes[0] < now - WINDOW_MS) errorTimes.shift();
  if (errorTimes.length > 10_000) errorTimes.splice(0, errorTimes.length - 10_000);
}
/** 최근 5분간 error 로그 수(헬스체크용) */
export function recentErrorCount(now = Date.now()): number {
  while (errorTimes.length && errorTimes[0] < now - WINDOW_MS) errorTimes.shift();
  return errorTimes.length;
}

export function errText(e: unknown): string {
  if (e instanceof Error) return redact(`${e.name}: ${e.message}`);
  return redact(String(e));
}

/** 테스트에서 출력 대상을 바꿀 수 있게 분리 */
let sink: (line: string, level: Level) => void = (line, level) => (level === "error" ? console.error(line) : level === "warn" ? console.warn(line) : console.log(line));
export function setLogSink(fn: typeof sink) { const prev = sink; sink = fn; return prev; }

export function log(level: Level, event: string, fields: Fields = {}, now = Date.now()) {
  const safe: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (BLOCKED_FIELDS.has(k)) { safe[k] = "[REDACTED]"; continue; }
    safe[k] = typeof v === "string" ? redact(v) : v;
  }
  if (level === "error") noteError(now);
  sink(JSON.stringify({ ts: new Date(now).toISOString(), level, event, ...safe }), level);
}
export const logInfo = (event: string, f?: Fields) => log("info", event, f);
export const logWarn = (event: string, f?: Fields) => log("warn", event, f);
export const logError = (event: string, e?: unknown, f?: Fields) => log("error", event, { ...f, ...(e !== undefined ? { error: errText(e) } : {}) });
