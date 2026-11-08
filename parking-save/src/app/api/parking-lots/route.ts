import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { parseSearchParams, searchLots } from "@/server/search";
import { apiError, internalError } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const parsed = parseSearchParams(req.nextUrl.searchParams);
  if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
  try {
    const res = await searchLots(await getAppDb(), parsed.params);
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } }); // 위치 포함 요청 → 캐시 금지
  } catch (e) {
    return internalError(e);
  }
}
