import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** 검색 결과·비교(위치·시간 매개변수)·관리자·API·언어 전환은 수집 제외. 상세·지역 목록은 허용 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/area", "/lots/"], disallow: ["/admin", "/api/", "/lang", "/search", "/compare", "/offline"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
