// 로그 마스킹: 비밀번호·토큰·사업자번호가 로그에 남지 않도록 한다.
const BIZNO = /\b\d{3}-?\d{2}-?\d{5}\b/g;
const SENSITIVE_KEYS = /pass(word)?|token|secret|cookie|authorization|api[_-]?key|business_?number|biz_?no|ciphertext/i;

export function redactString(s: string): string {
  return s.replace(BIZNO, "[BIZNO]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 5) return "[DEEP]";
  if (typeof v === "string") return redactString(v);
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redact(x, depth + 1)]));
  }
  return v;
}
export function logError(msg: string, extra?: unknown) {
  console.error(redactString(msg), extra === undefined ? "" : JSON.stringify(redact(extra)));
}
export function logInfo(msg: string, extra?: unknown) {
  console.log(redactString(msg), extra === undefined ? "" : JSON.stringify(redact(extra)));
}
