// 단순 고정 윈도 요청 제한 (SECURITY_PRIVACY.md: 요청 제한).
// ⚠ 한계: 프로세스 메모리 기반이라 인스턴스가 여러 개면 인스턴스별로 적용됨. 클라이언트 식별은
//   x-forwarded-for 끝에서 TRUSTED_PROXY_COUNT번째 값(신뢰 프록시가 덧붙인 접속 IP) — 프록시 뒤에서만 의미가 있음.
//   운영 인프라(OPEN_ISSUES #10) 결정 후 공유 저장소/엣지 제한으로 교체 권장.
export interface Limiter { check(key: string, now?: number): { ok: boolean; retryAfterSec: number } }

export function createLimiter(limit: number, windowMs: number): Limiter {
  const hits = new Map<string, { start: number; n: number }>();
  return {
    check(key, now = Date.now()) {
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k); // 메모리 상한 정리
      const cur = hits.get(key);
      if (!cur || now - cur.start >= windowMs) { hits.set(key, { start: now, n: 1 }); return { ok: true, retryAfterSec: 0 }; }
      cur.n++;
      return cur.n <= limit ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.start + windowMs - now) / 1000)) };
    },
  };
}

/**
 * 앞단 신뢰 프록시 수(기본 1). 프록시는 X-Forwarded-For 끝에 "자기가 본 접속 IP"를 덧붙이므로,
 * 끝에서 N번째 값이 실제 클라이언트다. 첫 값은 클라이언트가 임의로 보낸 값일 수 있어 쓰지 않는다.
 * (예: 클라이언트가 "1.1.1.1"을 보내면 프록시 1개 뒤에서 헤더는 "1.1.1.1, <실제 IP>")
 */
export function trustedProxyCount(): number {
  const n = Number(process.env.TRUSTED_PROXY_COUNT ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
}

export function clientKey(headers: Headers, proxies: number = trustedProxyCount()): string {
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const fromChain = chain.length >= proxies ? chain[chain.length - proxies] : chain[0];
  return (fromChain || headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export const searchLimiter = createLimiter(60, 60_000);   // 검색·상세: 분당 60회/클라이언트
export const adminLimiter = createLimiter(5, 60_000);
export const adminUiLimiter = createLimiter(30, 60_000); // 관리자 화면 조회·처리: 분당 30회(토큰은 32자 이상 무작위라 대입 공격 비현실적, 감사로그 남김)
export const reportLimiter = createLimiter(5, 3600_000);  // 오류 신고: 시간당 5회/클라이언트(도배 방지)     // 관리자 API: 분당 5회/클라이언트(무차별 대입 완화)
