// 화면 언어. 한국어가 기본이며, 영어는 주요 화면(홈·검색·결과·상세·비교)만 지원한다.
// 시설명·주소·원천 특기사항은 원천 데이터 그대로(한국어) 보여준다 — 임의 번역 금지(정보 왜곡 방지).
// 약관·처리방침·관리자 화면은 한국어만 제공한다.
export type Lang = "ko" | "en";
export const LANGS: readonly Lang[] = ["ko", "en"];
/** 언어 선택 쿠키(1년). 위치·개인정보를 담지 않음 */
export const LANG_COOKIE = "ps-lang";
export const parseLang = (v: string | null | undefined): Lang => (v === "en" ? "en" : "ko");
export const LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US" };

/** 언어 전환 후 돌아갈 경로: 같은 사이트의 경로만 허용(오픈 리다이렉트 방지) */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next) || next.length > 2000) return "/";
  return next;
}
