import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { parseSearchParams } from "@/server/search";
import { searchLotsCached } from "@/server/search-cache";
import { apiError, internalError, limited } from "@/server/http";
import { searchLimiter } from "@/server/rate-limit";
import { resolveDestination } from "@/server/place";
import { countUsage } from "@/server/usage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tooMany = limited(req, searchLimiter);
  if (tooMany) return tooMany;
  try {
    const db = await getAppDb();
    const sp = req.nextUrl.searchParams;
    const dest = sp.get("destination")?.trim();
    const parsed = parseSearchParams(sp, dest && !sp.get("lat") && !sp.get("lng") ? await resolveDestination(db, dest) : null);
    if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
    countUsage("search_api");
    const res = await searchLotsCached(db, parsed.params);
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } }); // 위치 포함 요청 → 캐시 금지
  } catch (e) {
    return internalError(e);
  }
}
