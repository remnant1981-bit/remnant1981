// 단순 고정 윈도 요청 제한 (SECURITY_PRIVACY.md: 요청 제한).
// ⚠ 한계: 프로세스 메모리 기반이라 인스턴스가 여러 개면 인스턴스별로 적용됨. 클라이언트 식별은 프록시가 붙이는
//   x-forwarded-for 첫 값을 사용하므로, 신뢰할 수 있는 프록시 뒤에서만 의미가 있음(직접 노출 시 위조 가능).
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

export function clientKey(headers: Headers): string {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export const searchLimiter = createLimiter(60, 60_000);   // 검색·상세: 분당 60회/클라이언트
export const adminLimiter = createLimiter(5, 60_000);     // 관리자 API: 분당 5회/클라이언트(무차별 대입 완화)
