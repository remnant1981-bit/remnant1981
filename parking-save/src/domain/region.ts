// 주소 → 시·도 / 시·군·구 (지역별 목록 페이지용). 원천 주소 표기가 불규칙해 확실한 경우만 판별하고, 오타·불명은 null(추정 금지).
// - 시·도: 알려진 이름으로 시작해야 함(띄어쓰기 누락 "강원특별자치도강릉시"도 허용). "전븍특별자치도" 같은 오타는 제외.
// - 시·군·구: 시·도 다음 토큰이 시/군/구로 끝날 때. "수원시 장안구"처럼 시 아래 구가 있으면 시 단위로 묶음.
// - 세종특별자치시는 하위 시·군·구가 없음 → 시·도 이름을 그대로 사용.

export const SIDO = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시",
  "경기도", "강원특별자치도", "강원도", "충청북도", "충청남도", "전북특별자치도", "전라북도", "전라남도", "경상북도", "경상남도",
  "제주특별자치도", "전남광주통합특별시",
] as const;
const NO_SIGUNGU = new Set<string>(["세종특별자치시"]);
// 긴 이름부터 비교(접두어가 겹치는 경우 대비)
const SIDO_BY_LEN = [...SIDO].sort((a, b) => b.length - a.length);

export interface Region { sido: string; sigungu: string }

export function regionOf(address: string | null | undefined): Region | null {
  if (!address) return null;
  const a = address.trim();
  const sido = SIDO_BY_LEN.find((s) => a.startsWith(s));
  if (!sido) return null;
  if (NO_SIGUNGU.has(sido)) return { sido, sigungu: sido };
  const rest = a.slice(sido.length).trim();
  const tok = rest.split(/\s+/)[0] ?? "";
  // 붙여 쓴 경우("강릉시교동")는 첫 시/군/구 단위까지만
  const m = /^([가-힣]{1,10}?(?:시|군|구))(?=$|[가-힣\d])/.exec(tok);
  if (!m) return null;
  return { sido, sigungu: m[1] };
}

/** URL 경로 조각(한글 그대로, 인코딩은 라우터가 처리) 검증: 알려진 시·도 + 시·군·구 형식만 */
export function isValidSido(s: string): boolean { return (SIDO as readonly string[]).includes(s); }
export function isValidSigungu(s: string): boolean { return /^[가-힣]{1,12}(시|군|구)$/.test(s); }
