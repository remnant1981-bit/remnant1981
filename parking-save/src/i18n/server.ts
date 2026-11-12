import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "./index";

/** 요청의 화면 언어(쿠키). 없으면 한국어 */
export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}
