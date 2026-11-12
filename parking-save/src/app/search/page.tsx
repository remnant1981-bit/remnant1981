import type { Metadata } from "next";
import Link from "next/link";
import { SearchForm } from "@/components/SearchForm";
import { LotCard } from "@/components/LotCard";
import { getAppDb } from "@/server/app-db";
import { WALK_WON_PER_100M, parseSearchParams, searchLots } from "@/server/search";
import { MOCK_PLACES, mockEnabled } from "@/server/mock";
import { kstLocalToIso, formatKst } from "@/lib/time";
import { headers } from "next/headers";
import { clientKey, searchLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";
import { ResultsMap, type MapItem } from "@/components/ResultsMap";
import { ShareButton } from "@/components/ShareButton";
import { CompareTray } from "@/components/CompareControls";
import { RecentSearchRecorder } from "@/components/RecentSearchRecorder";
import { feeText, won } from "@/lib/labels";

export const metadata: Metadata = { title: "검색 결과" };
const FIRST_LIMIT = 20, MORE_LIMIT = 50;
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
  for (const k of ["destination", "lat", "lng", "radiusMeters", "sort", "type", "freeOnly", "realtimeOnly", "operatingOnly"]) { const v = g(k); if (v) qs.set(k, v); }
  const sIso = kstLocalToIso(g("start")), eIso = kstLocalToIso(g("end"));
  if (sIso) qs.set("startAt", sIso);
  if (eIso) qs.set("endAt", eIso);

  const defaults = { destination: g("destination"), lat: g("lat"), lng: g("lng"), start: g("start"), end: g("end"), radiusMeters: g("radiusMeters"), sort: g("sort"), type: g("type"), freeOnly: !!g("freeOnly"), realtimeOnly: !!g("realtimeOnly"), operatingOnly: !!g("operatingOnly") };
  // 첫 화면은 20곳(화면 렌더링·전송량이 카드 수에 비례 — 부하 측정 기준), '더 보기'로 50곳
  const pageLimit = g("limit") === String(MORE_LIMIT) ? MORE_LIMIT : FIRST_LIMIT;
  qs.set("limit", String(pageLimit));
  const parsed = parseSearchParams(qs);
  const form = <SearchForm defaults={defaults} places={mockEnabled() ? Object.keys(MOCK_PLACES) : []} />;

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
  // 목록/지도 전환: 같은 검색 조건에 view만 바꾼 링크(공유·뒤로가기에도 유지)
  const view = g("view") === "map" ? "map" : "list";
  const pageQs = new URLSearchParams();
  for (const k of ["destination", "lat", "lng", "start", "end", "radiusMeters", "sort", "type", "freeOnly", "realtimeOnly", "operatingOnly"]) { const v = g(k); if (v) pageQs.set(k, v); }
  const viewHref = (v: "list" | "map") => { const q = new URLSearchParams(pageQs); if (v === "map") q.set("view", "map"); return `/search?${q.toString()}`; };
  const periodText = `${formatKst(res.requestedPeriod.startAt)} ~ ${formatKst(res.requestedPeriod.endAt)}`;
  const mapItems: MapItem[] = res.items.map((i) => {
    const f = feeText(i.fee);
    return { id: i.id, name: i.name, lat: i.latitude, lng: i.longitude, href: `/lots/${i.id}?${detailQuery}`,
      feeLabel: i.fee.status === "OK" ? (i.fee.isFree ? "무료" : won(i.fee.amount!)) : "?", tone: f.tone, amount: i.fee.status === "OK" ? i.fee.amount! : null,
      distanceLabel: i.distanceMeters >= 1000 ? `${(i.distanceMeters / 1000).toFixed(1)}km` : `${i.distanceMeters}m` };
  });
  const tab = (v: "list" | "map", label: string) => (
    <Link href={viewHref(v)} aria-current={view === v ? "page" : undefined}
      className={`rounded px-3 py-1.5 text-sm ${view === v ? "bg-blue-700 font-semibold text-white" : "border border-gray-400 text-gray-800"}`}>{label}</Link>
  );
  return (
    <>
      <h1 className="text-xl font-bold">{res.searchCenter.label} 주변 주차장</h1>
      <RecentSearchRecorder query={pageQs.toString()} label={res.searchCenter.label} period={periodText} />
      <p className="mt-1 text-sm text-gray-700">{periodText} (한국 시간) · 반경 {parsed.params.radiusMeters >= 1000 ? `${parsed.params.radiusMeters / 1000}km` : `${parsed.params.radiusMeters}m`}</p>
      <details className="my-4 rounded border border-gray-300 p-3"><summary className="cursor-pointer font-semibold">검색 조건 변경</summary><div className="mt-3">{form}</div></details>

      <p className="text-sm" role="status">
        {cov.candidates > cov.returned ? `후보 ${cov.candidates}곳 중 ` : ""}{cov.returned}곳 · 요금 계산 가능 {cov.feeCalculable}곳 · 요금 정보 없음/계산 불가 {cov.feeUnknown}곳 · 실시간 잔여면수 {cov.withValidRealtime}곳
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-2" aria-label="결과 보기 방식">{tab("list", "목록")}{tab("map", "지도")}</nav>
        <ShareButton title={`${res.searchCenter.label} 주변 주차장 요금 비교`} />
      </div>
      <p className="mt-2 text-xs text-gray-600">거리는 직선거리이며 실제 이동 거리와 다릅니다.{parsed.params.sort === "value_asc" && ` 가성비 순: 걸어가는 거리 100m를 ${WALK_WON_PER_100M.toLocaleString("ko-KR")}원으로 환산해 예상 요금에 더한 순서이며, 요금 계산 불가 시설은 뒤로 보냅니다.`}</p>
      {res.warnings.filter((w) => !w.startsWith("MOCK_DATA") && !w.startsWith("EMPTY")).map((w) => (
        <p key={w} className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm" role="note">{w.slice(w.indexOf(":") + 1).trim()}</p>
      ))}
      {view === "map" && res.items.length > 0 && (
        <ResultsMap center={{ lat: res.searchCenter.lat, lng: res.searchCenter.lng, label: res.searchCenter.label }} radiusMeters={parsed.params.radiusMeters} items={mapItems} />
      )}
      {res.items.length === 0 ? (
        <div className="mt-6 rounded border border-gray-300 p-4" role="status">
          <p className="font-semibold">조건에 맞는 주차장이 없습니다.</p>
          <p className="mt-1 text-sm">반경을 넓히거나 &lsquo;무료만&rsquo;·&lsquo;실시간 확인 가능만&rsquo;·&lsquo;운영 중인 곳만&rsquo; 필터를 해제해 보세요. <Link href="/" className="underline">처음으로</Link></p>
        </div>
      ) : (
        <>
          <ul className="mt-4 space-y-3">{res.items.map((i) => <LotCard key={i.id} item={i} query={detailQuery} />)}</ul>
          {pageLimit === FIRST_LIMIT && cov.candidates > cov.returned && (
            <p className="mt-4 text-center"><Link href={`/search?${(() => { const q = new URLSearchParams(pageQs); q.set("limit", String(MORE_LIMIT)); if (view === "map") q.set("view", "map"); return q.toString(); })()}`} className="inline-block rounded border border-gray-500 px-4 py-2 text-sm">결과 더 보기 (최대 {MORE_LIMIT}곳)</Link></p>
          )}
        </>
      )}
      <CompareTray query={`${detailQuery}&lat=${res.searchCenter.lat.toFixed(4)}&lng=${res.searchCenter.lng.toFixed(4)}`} />
    </>
  );
}
