/** 서비스 기준 주소(사이트맵·공유 미리보기·canonical). 운영은 SITE_URL 필수, 끝의 / 제거 */
export function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** 지역 페이지 경로(한글 경로 조각은 인코딩) */
export const areaHref = (sido: string, sigungu: string) => `/area/${encodeURIComponent(sido)}/${encodeURIComponent(sigungu)}`;
