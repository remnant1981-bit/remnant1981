import type { MetadataRoute } from "next";
import { getAppDb } from "@/server/app-db";
import { areaIndex } from "@/server/area";
import { NON_PRODUCTION_SOURCES, mockEnabled } from "@/server/mock";
import { areaHref, siteUrl } from "@/lib/site";
import { logError } from "@/server/log";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/** 사이트맵: 홈·지역 목록·지역별 페이지·주차장 상세(실서비스 원천, 제외 시설 빼고). 검색 결과(좌표 포함)는 넣지 않음 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const out: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/area`, changeFrequency: "daily", priority: 0.8 },
  ];
  try {
    const db = await getAppDb();
    for (const s of await areaIndex(db)) for (const g of s.sigungu) out.push({ url: base + areaHref(s.sido, g.name), changeFrequency: "daily", priority: 0.7 });
    const excluded = mockEnabled() ? [] : NON_PRODUCTION_SOURCES;
    const lots = await db.all<{ id: number; u: string | null }>(
      `SELECT id, source_updated_at AS u FROM parking_lots WHERE data_status NOT LIKE 'EXCLUDED%'${excluded.length ? ` AND source_name NOT IN (${excluded.map(() => "?").join(",")})` : ""} ORDER BY id LIMIT 45000`, [...excluded]);
    for (const l of lots) out.push({ url: `${base}/lots/${l.id}`, lastModified: l.u && !Number.isNaN(Date.parse(l.u)) ? new Date(l.u) : undefined, changeFrequency: "weekly", priority: 0.5 });
  } catch (e) { logError("sitemap.error", e); } // DB 오류여도 기본 항목은 제공
  return out;
}
