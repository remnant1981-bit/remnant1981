import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getAppDb } from "@/server/app-db";
import { getLotDetail } from "@/server/search";
import { clientKey, searchLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";
import { FEE_ANOMALY_LABEL } from "@/domain/fee-check";
import { distanceMeters, isValidCoord } from "@/domain/geo";
import { OPERATING_LABEL, TYPE_LABEL, feeText, won } from "@/lib/labels";
import { formatKst, parseOffsetIso } from "@/lib/time";

export const metadata: Metadata = { title: "주차장 비교" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const HOURS = [1, 2, 3, 6, 12];

/** 최대 3곳 나란히 비교(같은 이용 시간 기준) */
export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const rl = searchLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests retryAfterSec={rl.retryAfterSec} />;
  const sp = await searchParams;
  const ids = [...new Set((one(sp.ids) ?? "").split(",").filter((x) => /^\d{1,9}$/.test(x)).map(Number))].slice(0, 3);
  const s = parseOffsetIso(one(sp.startAt)), e = parseOffsetIso(one(sp.endAt));
  const period = s && e && e > s ? { startAt: s, endAt: e } : null;
  const cLat = Number(one(sp.destLat) ?? one(sp.lat)), cLng = Number(one(sp.destLng) ?? one(sp.lng));
  const center = isValidCoord({ lat: cLat, lng: cLng }) ? { lat: cLat, lng: cLng } : null;
  if (ids.length < 2) {
    return (<><h1 className="text-xl font-bold">주차장 비교</h1><p className="mt-2 text-sm">비교할 주차장을 2곳 이상 담아 주세요. <Link href="/" className="underline">처음으로</Link></p></>);
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
      <h1 className="text-xl font-bold">주차장 비교</h1>
      <p className="mt-1 text-sm text-gray-700">{period ? `${formatKst(period.startAt)} ~ ${formatKst(period.endAt)} 이용 기준` : "이용 시간을 지정하지 않아 요금은 표시하지 않습니다"}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm tabular-nums">
          <caption className="sr-only">주차장 {lots.length}곳 비교</caption>
          <thead><tr><th scope="col" className={cell}><span className="sr-only">항목</span></th>{lots.map((d) => <th key={d.lot.id} scope="col" className={`${cell} text-left`}><Link href={`/lots/${d.lot.id}${detailQ}`} className="underline">{d.lot.name}</Link></th>)}</tr></thead>
          <tbody>
            {row("예상 요금", (d) => { if (!d.fee) return "-"; const f = feeText(d.fee); return <><b>{f.main}</b>{f.sub && <span className="block text-xs text-gray-600">{f.sub}</span>}</>; })}
            {row("운영", (d) => (d.operating ? OPERATING_LABEL[d.operating] + (d.operatingAssumed ? " (추정)" : "") : "-"))}
            {HOURS.map((h) => row(`${h}시간 이용`, (d) => { const p = d.feeCurve?.find((x) => x.hours === h); return p ? (p.fee == null ? "계산 불가" : won(p.fee) + (p.capped ? " (일 최대)" : "")) : "-"; }, `h${h}`))}
            {center && row("거리(직선)", (d) => (d.lot.latitude != null && d.lot.longitude != null ? `${Math.round(distanceMeters(center, { lat: d.lot.latitude, lng: d.lot.longitude }))}m` : "-"))}
            {row("유형·면수", (d) => `${TYPE_LABEL[d.lot.parkingType]} · ${d.lot.totalSpaces != null ? `${d.lot.totalSpaces}면` : "면수 정보 없음"}`)}
            {row("월 정기권", (d) => (d.monthlyPass != null ? won(d.monthlyPass) : "-"))}
            {row("감면·할인", (d) => (d.discounts.length ? d.discounts.join("·") : "-"))}
            {row("요금 확인 필요", (d) => (d.feeWarnings.length ? d.feeWarnings.map((w) => FEE_ANOMALY_LABEL[w]).join(", ") : "-"))}
            {row("출처 기준일", (d) => (d.source.updatedAt ? formatKst(d.source.updatedAt) : "미확인"))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-600">요금은 원천 데이터 기준 예상 금액이며 감면·할인은 반영하지 않았습니다. 거리는 직선거리입니다.</p>
    </>
  );
}
