import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const site = process.env.SITE_URL || "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: ["/", "/search", "/announcements/"], disallow: ["/api/", "/admin", "/my", "/company", "/login", "/register"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
