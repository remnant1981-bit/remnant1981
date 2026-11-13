import type { Metadata } from "next";
import Link from "next/link";
import { getAppDb } from "@/server/app-db";
import { areaIndex } from "@/server/area";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";
import { areaHref } from "@/lib/site";
import { headers } from "next/headers";
import { clientKey, pageLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang()).area;
  return { title: t.title, description: t.intro, alternates: { canonical: "/area" } };
}

/** 지역 목록(시·도 → 시·군·구). 검색 엔진이 지역별 페이지를 찾을 수 있게 하는 진입점 */
export default async function AreaIndexPage() {
  const rl = pageLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests lang={await getLang()} retryAfterSec={rl.retryAfterSec} />;
  const lang = await getLang();
  const t = dict(lang).area;
  const idx = await areaIndex(await getAppDb());
  return (
    <>
      <h1 className="text-xl font-bold">{t.title}</h1>
      <p className="mt-1 text-sm text-gray-700">{t.intro}</p>
      <div className="mt-4 space-y-4">
        {idx.map((s) => (
          <section key={s.sido} aria-labelledby={`sido-${s.sido}`}>
            <h2 id={`sido-${s.sido}`} className="font-semibold" lang="ko">{s.sido} <span className="text-sm font-normal text-gray-600" lang={lang}>{t.lots(s.count)}</span></h2>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {s.sigungu.map((g) => <li key={g.name}><Link href={areaHref(s.sido, g.name)} className="underline" lang="ko">{g.name}</Link> <span className="text-xs text-gray-600">{g.count}</span></li>)}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-gray-600">{t.excluded} {t.source}</p>
    </>
  );
}
