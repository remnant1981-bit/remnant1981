import type { MetadataRoute } from "next";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.SITE_URL || "http://localhost:3000";
  const db = await getDb();
  // 테스트(모의) 데이터는 색인 대상에서 제외
  const rows = await db.all<{ id: string; updated_at: string }>(
    "SELECT a.id, a.updated_at FROM announcements a JOIN data_sources s ON s.id=a.source_id WHERE a.is_active=1 AND s.integration_status<>'mock' ORDER BY a.updated_at DESC LIMIT 5000");
  return [{ url: site, changeFrequency: "daily" }, { url: `${site}/search`, changeFrequency: "daily" }, ...rows.map((r) => ({ url: `${site}/announcements/${r.id}`, lastModified: r.updated_at }))];
}
