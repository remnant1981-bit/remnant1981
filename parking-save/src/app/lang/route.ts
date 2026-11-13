import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, parseLang, safeNext } from "@/i18n";
import { limited } from "@/server/http";
import { langLimiter } from "@/server/rate-limit";

/** 화면 언어 전환: 쿠키를 저장하고 같은 사이트의 원래 화면으로 돌려보낸다(JS 없이도 동작) */
export function GET(req: NextRequest) {
  const tooMany = limited(req, langLimiter);
  if (tooMany) return tooMany;
  const lang = parseLang(req.nextUrl.searchParams.get("to"));
  // 상대 경로 Location(프록시 뒤에서도 호스트·스킴을 추측하지 않음)
  const res = new NextResponse(null, { status: 303, headers: { Location: safeNext(req.nextUrl.searchParams.get("next")) } });
  res.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 365 * 86400, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
