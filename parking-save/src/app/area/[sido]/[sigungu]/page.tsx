import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppDb } from "@/server/app-db";
import { areaLots, type AreaLot } from "@/server/area";
import { isValidSido, isValidSigungu } from "@/domain/region";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";
import { defaultStayInputs } from "@/lib/time";
import { areaHref, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
type P = Promise<{ sido: string; sigungu: string }>;
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return ""; } };
async function region(params: P) {
  const p = await params;
  const sido = dec(p.sido), sigungu = dec(p.sigungu);
  if (!isValidSido(sido) || !(isValidSigungu(sigungu) || sigungu === sido)) return null;
  return { sido, sigungu, label: sido === sigungu ? sido : `${sido} ${sigungu}` };
}

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const r = await region(params);
  if (!r) return {};
  const lots = await areaLots(await getAppDb(), r);
  if (!lots) return {};
  const t = dict(await getLang()).area;
  const path = areaHref(r.sido, r.sigungu);
  return { title: t.heading(r.label), description: t.desc(r.label, lots.length), alternates: { canonical: path }, openGraph: { title: t.heading(r.label), description: t.desc(r.label, lots.length), url: path } };
}

/** 대표 좌표(중앙값) — '이 지역에서 검색' 링크용. 좌표 없는 시설 제외 */
function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

export default async function AreaPage({ params }: { params: P }) {
  const r = await region(params);
  if (!r) notFound();
  const lots = await areaLots(await getAppDb(), r);
  if (!lots) notFound();
  const lang = await getLang();
  const d = dict(lang), t = d.area;
  const free = lots.filter((l) => l.fee.kind === "FREE").length, paid = lots.filter((l) => l.fee.kind === "PAID").length;
  const pts = lots.filter((l) => l.lat != null && l.lng != null) as Array<AreaLot & { lat: number; lng: number }>;
  const stay = defaultStayInputs();
  const searchHref = pts.length ? `/search?${new URLSearchParams({ lat: median(pts.map((p) => p.lat)).toFixed(3), lng: median(pts.map((p) => p.lng)).toFixed(3), radiusMeters: "3000", start: stay.start, end: stay.end, sort: "free_first" })}` : null;
  const feeCell = (l: AreaLot) => l.fee.kind === "FREE" ? <span className="font-semibold text-green-800">{t.free}</span> : l.fee.kind === "PAID" && l.fee.base ? t.base(l.fee.base.minutes, d.money(l.fee.base.amount)) : <span className="text-gray-600">{t.unknown}</span>;
  // 구조화 데이터: 이 지역 주차장 목록(ItemList). 금액·좌표는 넣지 않음(추정으로 읽히지 않게)
  const jsonLd = { "@context": "https://schema.org", "@type": "ItemList", name: t.heading(r.label), numberOfItems: lots.length,
    itemListElement: lots.slice(0, 100).map((l, i) => ({ "@type": "ListItem", position: i + 1, url: `${siteUrl()}/lots/${l.id}`, name: l.name })) };
  return (
    <>
      <p className="text-sm"><Link href="/area" className="underline">← {t.all}</Link></p>
      <h1 className="mt-2 text-xl font-bold">{t.heading(r.label)}</h1>
      <p className="mt-1 text-sm text-gray-700" role="status">{t.summary(lots.length, free, paid)}</p>
      {searchHref && <p className="mt-3"><Link href={searchHref} className="inline-block rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white">{t.search}</Link></p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm tabular-nums">
          <caption className="sr-only">{t.heading(r.label)}</caption>
          <thead><tr className="border-b border-gray-300 text-left text-gray-600">{t.cols.map((c) => <th key={c} scope="col" className="py-1 pr-3">{c}</th>)}</tr></thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} className="border-b border-gray-200 align-top">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal"><Link href={`/lots/${l.id}`} className="underline" lang="ko">{l.name}</Link>{l.address && <span className="block text-xs text-gray-600" lang="ko">{l.address}</span>}</th>
                <td className="py-1.5 pr-3">{d.type[l.parkingType]}</td>
                <td className="py-1.5 pr-3">{feeCell(l)}</td>
                <td className="py-1.5 pr-3">{l.fee.dailyMax != null ? d.money(l.fee.dailyMax) : "-"}</td>
                <td className="py-1.5">{l.totalSpaces ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-600">{t.note} {t.source}</p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
