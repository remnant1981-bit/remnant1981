import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getAppDb } from "@/server/app-db";
import { getLotDetail } from "@/server/search";
import { clientKey, searchLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";
import { distanceMeters, isValidCoord } from "@/domain/geo";
import { labelsFor } from "@/lib/labels";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";
import { formatKst, parseOffsetIso } from "@/lib/time";

export async function generateMetadata(): Promise<Metadata> { return { title: dict(await getLang()).compare.title }; }
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const HOURS = [1, 2, 3, 6, 12];

/** 최대 3곳 나란히 비교(같은 이용 시간 기준) */
export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const lang = await getLang();
  const { t, feeText, discountLabel } = labelsFor(lang);
  const C = t.compare, won = t.money;
  const rl = searchLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests lang={lang} retryAfterSec={rl.retryAfterSec} />;
  const sp = await searchParams;
  const ids = [...new Set((one(sp.ids) ?? "").split(",").filter((x) => /^\d{1,9}$/.test(x)).map(Number))].slice(0, 3);
  const s = parseOffsetIso(one(sp.startAt)), e = parseOffsetIso(one(sp.endAt));
  const period = s && e && e > s ? { startAt: s, endAt: e } : null;
  const cLat = Number(one(sp.destLat) ?? one(sp.lat)), cLng = Number(one(sp.destLng) ?? one(sp.lng));
  const center = isValidCoord({ lat: cLat, lng: cLng }) ? { lat: cLat, lng: cLng } : null;
  if (ids.length < 2) {
    return (<><h1 className="text-xl font-bold">{C.title}</h1><p className="mt-2 text-sm">{C.needTwo} <Link href="/" className="underline">{t.search.home}</Link></p></>);
  }
  const db = await getAppDb();
  const lots = (await Promise.all(ids.map((id) => getLotDetail(db, id, period)))).filter((d) => d != null);
  const detailQ = period ? `?startAt=${encodeURIComponent(period.startAt.toISOString())}&endAt=${encodeURIComponent(period.endAt.toISOString())}` : "";
  const cell = "border-b border-gray-300 px-2 py-2 align-top";
  // 행 렌더 함수(컴포넌트를 렌더 중에 만들지 않도록 일반 함수로 호출)
  const row = (label: string, render: (d: (typeof lots)[number]) => React.ReactNode, key = label) => (
    <tr key={key}><th scope="row" className={`${cell} whitespace-nowrap text-left font-medium text-gray-700`}>{label}</th>{lots.map((d) => <td key={d.lot.id} className={cell}>{render(d)}</td>)}</tr>
  );
  return (
    <>
      <h1 className="text-xl font-bold">{C.title}</h1>
      <p className="mt-1 text-sm text-gray-700">{period ? C.period(`${formatKst(period.startAt, lang)} ~ ${formatKst(period.endAt, lang)}`) : C.noPeriod}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm tabular-nums">
          <caption className="sr-only">{C.caption(lots.length)}</caption>
          <thead><tr><th scope="col" className={cell}><span className="sr-only">{C.item}</span></th>{lots.map((d) => <th key={d.lot.id} scope="col" className={`${cell} text-left`}><Link href={`/lots/${d.lot.id}${detailQ}`} className="underline" lang="ko">{d.lot.name}</Link></th>)}</tr></thead>
          <tbody>
            {row(C.fee, (d) => { if (!d.fee) return "-"; const f = feeText(d.fee); return <><b>{f.main}</b>{f.sub && <span className="block text-xs text-gray-600">{f.sub}</span>}</>; })}
            {row(C.operating, (d) => (d.operating ? t.operating[d.operating] + (d.operatingAssumed ? C.assumed : "") : "-"))}
            {HOURS.map((h) => row(C.stay(h), (d) => { const p = d.feeCurve?.find((x) => x.hours === h); return p ? (p.fee == null ? t.fee.notCalculable : won(p.fee) + (p.capped ? C.capped : "")) : "-"; }, `h${h}`))}
            {center && row(C.dist, (d) => (d.lot.latitude != null && d.lot.longitude != null ? `${Math.round(distanceMeters(center, { lat: d.lot.latitude, lng: d.lot.longitude }))}m` : "-"))}
            {row(C.typeSpaces, (d) => `${t.type[d.lot.parkingType]} · ${d.lot.totalSpaces != null ? t.spaces(d.lot.totalSpaces) : C.noSpaces}`)}
            {row(C.pass, (d) => (d.monthlyPass != null ? won(d.monthlyPass) : "-"))}
            {row(C.disc, (d) => (d.discounts.length ? d.discounts.map(discountLabel).join(lang === "ko" ? "·" : ", ") : "-"))}
            {row(C.warn, (d) => (d.feeWarnings.length ? d.feeWarnings.map((w) => t.anomaly[w]).join(", ") : "-"))}
            {row(C.asOf, (d) => (d.source.updatedAt ? formatKst(d.source.updatedAt, lang) : t.detail.unverified))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-600">{C.note}</p>
    </>
  );
}
