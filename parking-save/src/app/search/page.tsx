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
import { labelsFor } from "@/lib/labels";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";
import { logError } from "@/server/log";

export async function generateMetadata(): Promise<Metadata> { return { title: dict(await getLang()).search.title }; }
const FIRST_LIMIT = 20, MORE_LIMIT = 50;
export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  // 화면 경로도 API와 같은 한도(분당 60회/클라이언트)로 제한 — DB 조회 전에 차단
  const lang = await getLang();
  const { t, feeText } = labelsFor(lang);
  const S = t.search;
  const rl = searchLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests lang={lang} retryAfterSec={rl.retryAfterSec} />;
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
  if (lang === "en") qs.set("lang", "en");
  const parsed = parseSearchParams(qs);
  const form = <SearchForm lang={lang} defaults={defaults} places={mockEnabled() ? Object.keys(MOCK_PLACES) : []} />;

  if (!parsed.ok) {
    return (<><h1 className="mb-4 text-xl font-bold">{S.title}</h1>
      <p role="alert" className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">{lang === "ko" ? parsed.message : (S.errors[parsed.code] ?? S.errors.INVALID_PERIOD)}</p>{form}</>);
  }
  let res;
  try { res = await searchLots(await getAppDb(), parsed.params); }
  catch (e) {
    logError("search_page.error", e);
    return (<><h1 className="mb-4 text-xl font-bold">{S.title}</h1>
      <p role="alert" className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">{S.error}</p>{form}</>);
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
  const periodText = `${formatKst(res.requestedPeriod.startAt, lang)} ~ ${formatKst(res.requestedPeriod.endAt, lang)}`;
  // 현재 위치 검색의 라벨은 서버 고정값 → 화면 언어로. 목적지 이름은 입력값 그대로
  const centerLabel = res.searchCenter.kind === "current_location" ? S.currentLocation : res.searchCenter.label;
  const mapItems: MapItem[] = res.items.map((i) => {
    const f = feeText(i.fee);
    return { id: i.id, name: i.name, lat: i.latitude, lng: i.longitude, href: `/lots/${i.id}?${detailQuery}`,
      feeLabel: i.fee.status === "OK" ? (i.fee.isFree ? t.fee.free : t.money(i.fee.amount!)) : "?", tone: f.tone, amount: i.fee.status === "OK" ? i.fee.amount! : null,
      distanceLabel: t.dist(i.distanceMeters) };
  });
  const tab = (v: "list" | "map", label: string) => (
    <Link href={viewHref(v)} aria-current={view === v ? "page" : undefined}
      className={`rounded px-3 py-1.5 text-sm ${view === v ? "bg-blue-700 font-semibold text-white" : "border border-gray-400 text-gray-800"}`}>{label}</Link>
  );
  return (
    <>
      <h1 className="text-xl font-bold">{S.heading(centerLabel)}</h1>
      <RecentSearchRecorder query={pageQs.toString()} label={centerLabel} period={periodText} />
      <p className="mt-1 text-sm text-gray-700">{periodText} {S.kst} · {S.radius(t.dist(parsed.params.radiusMeters))}</p>
      <details className="my-4 rounded border border-gray-300 p-3"><summary className="cursor-pointer font-semibold">{S.change}</summary><div className="mt-3">{form}</div></details>

      <p className="text-sm" role="status">
        {S.coverage(cov)}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-2" aria-label={S.viewNav}>{tab("list", S.list)}{tab("map", S.map)}</nav>
        <ShareButton lang={lang} title={S.shareTitle(centerLabel)} />
      </div>
      <p className="mt-2 text-xs text-gray-600">{S.distNote}{parsed.params.sort === "value_asc" && S.valueNote(t.money(WALK_WON_PER_100M))}</p>
      {res.warnings.filter((w) => !w.startsWith("MOCK_DATA") && !w.startsWith("EMPTY")).map((w) => (
        <p key={w} className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm" role="note">{(lang === "ko" ? null : S.warnings[w.slice(0, w.indexOf(":"))]) ?? w.slice(w.indexOf(":") + 1).trim()}</p>
      ))}
      {view === "map" && res.items.length > 0 && (
        <ResultsMap lang={lang} center={{ lat: res.searchCenter.lat, lng: res.searchCenter.lng, label: centerLabel }} radiusMeters={parsed.params.radiusMeters} items={mapItems} />
      )}
      {res.items.length === 0 ? (
        <div className="mt-6 rounded border border-gray-300 p-4" role="status">
          <p className="font-semibold">{S.empty}</p>
          <p className="mt-1 text-sm">{S.emptyHint} <Link href="/" className="underline">{S.home}</Link></p>
        </div>
      ) : (
        <>
          <ul className="mt-4 space-y-3">{res.items.map((i) => <LotCard lang={lang} key={i.id} item={i} query={detailQuery} />)}</ul>
          {pageLimit === FIRST_LIMIT && cov.candidates > cov.returned && (
            <p className="mt-4 text-center"><Link href={`/search?${(() => { const q = new URLSearchParams(pageQs); q.set("limit", String(MORE_LIMIT)); if (view === "map") q.set("view", "map"); return q.toString(); })()}`} className="inline-block rounded border border-gray-500 px-4 py-2 text-sm">{S.more(MORE_LIMIT)}</Link></p>
          )}
        </>
      )}
      <CompareTray lang={lang} query={`${detailQuery}&lat=${res.searchCenter.lat.toFixed(4)}&lng=${res.searchCenter.lng.toFixed(4)}`} />
    </>
  );
}
