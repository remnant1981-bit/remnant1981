/**
 * 공공데이터포털 서비스키 정규화. 포털은 같은 키를 Encoding(`...%3D%3D`)·Decoding(`...==`) 두 형태로 보여 주는데,
 * 요청 주소를 만들 때 이 코드가 한 번 더 인코딩하므로 **원본(Decoding) 형태**여야 한다(Encoding 형태를 넣으면 이중 인코딩으로 인증 오류).
 * 키의 원본 문자는 base64 계열(A-Z a-z 0-9 + / =)이라 `%XX`가 나올 수 없으므로, 있으면 인코딩된 형태로 보고 되돌린다.
 */
export function normalizeServiceKey(key: string): string {
  const k = key.trim();
  if (!/%[0-9A-Fa-f]{2}/.test(k)) return k;
  try { return decodeURIComponent(k); } catch { return k; }
}
