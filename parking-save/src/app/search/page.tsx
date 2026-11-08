import type { Metadata } from "next";
import Link from "next/link";
import { SearchForm } from "@/components/SearchForm";
import { LotCard } from "@/components/LotCard";
import { getAppDb } from "@/server/app-db";
import { parseSearchParams, searchLots } from "@/server/search";
import { MOCK_PLACES } from "@/server/mock";
import { kstLocalToIso, formatKst } from "@/lib/time";
import { headers } from "next/headers";
import { clientKey, searchLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";

export const metadata: Metadata = { title: "검색 결과" };
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  // 화면 경로도 API와 같은 한도(분당 60회/클라이언트)로 제한 — DB 조회 전에 차단
  const rl = searchLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests retryAfterSec={rl.retryAfterSec} />;
  const sp = await searchParams;
  const g = (k: string) => one(sp[k]);
  const qs = new URLSearchParams();
  for (const k of ["destination", "lat", "lng", "radiusMeters", "sort", "type", "freeOnly", "realtimeOnly"]) { const v = g(k); if (v) qs.set(k, v); }
  const sIso = kstLocalToIso(g("start")), eIso = kstLocalToIso(g("end"));
  if (sIso) qs.set("startAt", sIso);
  if (eIso) qs.set("endAt", eIso);

  const defaults = { destination: g("destination"), lat: g("lat"), lng: g("lng"), start: g("start"), end: g("end"), radiusMeters: g("radiusMeters"), sort: g("sort"), type: g("type"), freeOnly: !!g("freeOnly"), realtimeOnly: !!g("realtimeOnly") };
  const parsed = parseSearchParams(qs);
  const form = <SearchForm defaults={defaults} places={Object.keys(MOCK_PLACES)} />;

  if (!parsed.ok) {
    return (<><h1 className="mb-4 text-xl font-bold">검색 결과</h1>
      <p role="alert" className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">{parsed.message}</p>{form}</>);
  }
  let res;
  try { res = await searchLots(await getAppDb(), parsed.params); }
  catch (e) {
    console.error("[search page]", e);
    return (<><h1 className="mb-4 text-xl font-bold">검색 결과</h1>
      <p role="alert" className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">일시적인 오류로 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>{form}</>);
  }
  const dq = new URLSearchParams({ startAt: sIso!, endAt: eIso! });
  if (res.searchCenter.kind === "destination") { // 주차 후 목적지까지 도보 안내용(현재 위치 검색은 목적지 없음)
    dq.set("destLat", String(res.searchCenter.lat)); dq.set("destLng", String(res.searchCenter.lng)); dq.set("destName", res.searchCenter.label);
  }
  const detailQuery = dq.toString();
  const cov = res.dataCoverage;
  return (
    <>
      <h1 className="text-xl font-bold">{res.searchCenter.label} 주변 주차장</h1>
      <p className="mt-1 text-sm text-gray-700">{formatKst(res.requestedPeriod.startAt)} ~ {formatKst(res.requestedPeriod.endAt)} (한국 시간) · 반경 {parsed.params.radiusMeters >= 1000 ? `${parsed.params.radiusMeters / 1000}km` : `${parsed.params.radiusMeters}m`}</p>
      <details className="my-4 rounded border border-gray-300 p-3"><summary className="cursor-pointer font-semibold">검색 조건 변경</summary><div className="mt-3">{form}</div></details>

      <p className="text-sm" role="status">
        {cov.returned}곳 · 요금 계산 가능 {cov.feeCalculable}곳 · 요금 정보 없음/계산 불가 {cov.feeUnknown}곳 · 실시간 잔여면수 {cov.withValidRealtime}곳
      </p>
      <p className="mt-1 text-xs text-gray-600">지도 보기는 준비 중입니다(목록만 제공). 거리는 직선거리이며 실제 이동 거리와 다릅니다.</p>
      {res.warnings.filter((w) => !w.startsWith("MOCK_DATA") && !w.startsWith("EMPTY")).map((w) => (
        <p key={w} className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm" role="note">{w.slice(w.indexOf(":") + 1).trim()}</p>
      ))}
      {res.items.length === 0 ? (
        <div className="mt-6 rounded border border-gray-300 p-4" role="status">
          <p className="font-semibold">조건에 맞는 주차장이 없습니다.</p>
          <p className="mt-1 text-sm">반경을 넓히거나 &lsquo;무료만&rsquo;·&lsquo;실시간 확인 가능만&rsquo; 필터를 해제해 보세요. <Link href="/" className="underline">처음으로</Link></p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">{res.items.map((i) => <LotCard key={i.id} item={i} query={detailQuery} />)}</ul>
      )}
    </>
  );
}
