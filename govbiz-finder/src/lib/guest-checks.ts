// 비회원 공고별 조건 확인 결과: 브라우저 쿠키에만 보관(최근 50건). 형식: 공고ID~조건키~y|n 을 '|'로 연결
export const CHECKS_COOKIE = "gbf_checks";
export type Verdict = "yes" | "no";
export type ChecksMap = Record<string, Record<string, Verdict>>;
const MAX = 50;
const ID = /^[0-9a-zA-Z_-]{8,64}$/;
const FK = /^[a-z_]{2,40}$/;

export function decodeChecks(raw: string | null | undefined): ChecksMap {
  const out: ChecksMap = {};
  if (!raw || raw.length > 3800) return out;
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { return out; }
  for (const part of s.split("|")) {
    const [id, fk, v] = part.split("~");
    if (!ID.test(id ?? "") || !FK.test(fk ?? "") || (v !== "y" && v !== "n")) continue;
    (out[id] ??= {})[fk] = v === "y" ? "yes" : "no";
  }
  return out;
}

/** 목록 순서를 유지해 오래된 항목부터 버린다(새 항목은 뒤에 추가). */
export function encodeChecks(entries: [string, string, Verdict][]): string {
  return encodeURIComponent(entries.slice(-MAX).map(([id, fk, v]) => `${id}~${fk}~${v === "yes" ? "y" : "n"}`).join("|"));
}

/** 브라우저에서만 호출: 한 항목 설정/해제 후 쿠키 저장 */
export function setGuestCheck(id: string, fk: string, v: Verdict | ""): void {
  const m = document.cookie.split("; ").find((x) => x.startsWith(`${CHECKS_COOKIE}=`));
  const cur = decodeChecks(m ? m.slice(CHECKS_COOKIE.length + 1) : null);
  const list: [string, string, Verdict][] = [];
  for (const [aid, fks] of Object.entries(cur)) for (const [k, val] of Object.entries(fks)) if (!(aid === id && k === fk)) list.push([aid, k, val]);
  if (v) list.push([id, fk, v]);
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CHECKS_COOKIE}=${encodeChecks(list)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax${secure}`;
}
