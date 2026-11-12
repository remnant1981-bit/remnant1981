import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppDb } from "@/server/app-db";
import { getLotDetail } from "@/server/search";
import { MapLinks } from "@/components/MapLinks";
import { buildNaverLinks } from "@/domain/map-link";
import { isValidCoord } from "@/domain/geo";
import { labelsFor } from "@/lib/labels";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";
import { lotSummary } from "@/server/area";
import type { Metadata } from "next";
import { formatKst, parseOffsetIso } from "@/lib/time";
import { headers } from "next/headers";
import { clientKey, searchLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ShareButton } from "@/components/ShareButton";
import type { DayBreakdown } from "@/domain/fee";
import { FeeCurve } from "@/components/FeeCurve";
import { ParkingTimerPanel } from "@/components/ParkingTimer";
import { ReportForm } from "@/components/ReportForm";

export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 검색·공유용 메타데이터: 이름·주소·유형·대표 요금(요금 계산 없이). canonical은 기간 매개변수 없는 주소 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return {};
  const s = await lotSummary(await getAppDb(), Number(id));
  if (!s) return {};
  const d = dict(await getLang());
  const fee = s.fee.kind === "FREE" ? d.area.free : s.fee.kind === "PAID" && s.fee.base ? d.area.base(s.fee.base.minutes, d.money(s.fee.base.amount)) : d.fee.unknown;
  const description = [s.address, d.type[s.parkingType], `${d.area.cols[2]}: ${fee}`].filter(Boolean).join(" · ");
  return { title: s.name, description, alternates: { canonical: `/lots/${id}` }, openGraph: { title: s.name, description, url: `/lots/${id}` } };
}

export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const lang = await getLang();
  const { t, feeText, occupancyText, sourceLabel, discountLabel, domainText } = labelsFor(lang);
  const D = t.detail, won = t.money;
  const rl = searchLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests lang={lang} retryAfterSec={rl.retryAfterSec} />;
  const sp = await searchParams;
  const s = parseOffsetIso(one(sp.startAt)), e = parseOffsetIso(one(sp.endAt));
  const period = s && e && e > s ? { startAt: s, endAt: e } : null;
  const d = await getLotDetail(await getAppDb(), Number(id), period);
  if (!d) notFound();
  const { lot } = d;
  const fee = d.fee ? feeText(d.fee) : null;
  const occ = occupancyText(d.occupancy);
  const addr = lot.roadAddress ?? lot.address ?? "";
  const coord = lot.latitude != null && lot.longitude != null ? `${lot.latitude}, ${lot.longitude}` : null;
  // 도보 길찾기용 목적지(목적지 검색일 때만 검색 화면에서 전달). 입력 검증 후 사용
  const dLat = Number(one(sp.destLat)), dLng = Number(one(sp.destLng));
  const destination = one(sp.destLat) && one(sp.destLng) && isValidCoord({ lat: dLat, lng: dLng })
    ? { lat: dLat, lng: dLng, name: (one(sp.destName) ?? "").slice(0, 60) } : null;
  const links = lot.latitude != null && lot.longitude != null
    ? buildNaverLinks({ lot: { lat: lot.latitude, lng: lot.longitude, name: lot.name }, destination, appname: process.env.SITE_URL || "http://localhost:3000" })
    : { car: null, walk: null, place: null };
  // 그래프에서 강조할 막대: 입력한 이용 시간이 1~12시간 정수일 때
  const stayMin = d.requestedPeriod ? (Date.parse(d.requestedPeriod.endAt) - Date.parse(d.requestedPeriod.startAt)) / 60000 : 0;
  const stayHours = stayMin > 0 && stayMin % 60 === 0 && stayMin / 60 <= 12 ? stayMin / 60 : null;
  const days = (d.fee?.status === "OK" ? (d.fee.days ?? []) : []) as DayBreakdown[];
  const hhmm = t.hhmm;
  const hm = (r: { startTime: string | null; endTime: string | null }) => (r.startTime ? `${r.startTime}~${r.endTime}` : D.allDay);
  const ruleText = (r: (typeof d.feeRules)[number]) =>
    r.ruleType === "FREE" ? t.fee.free : r.amount == null ? D.amountUnknown : r.ruleType === "DAILY_MAX" ? won(r.amount) : D.per(r.durationMinutes ?? "?", won(r.amount));
  const sep = lang === "ko" ? "·" : ", ";
  return (
    <>
      <p><Link href="/" className="text-sm underline">{D.home}</Link></p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-bold" lang="ko">{lot.name}</h1>
        <span className="flex flex-wrap items-center gap-2"><FavoriteButton lang={lang} id={lot.id} name={lot.name} address={addr || null} /><ShareButton lang={lang} title={D.shareTitle(lot.name)} /></span>
      </div>
      <p className="text-sm text-gray-700">{t.type[lot.parkingType]} · {t.ownership[lot.ownershipType]}{lot.operatorName ? <> · <span lang="ko">{lot.operatorName}</span></> : ""}</p>

      <section className="mt-4" aria-labelledby="loc"><h2 id="loc" className="font-semibold">{D.loc}</h2>
        <p className="text-sm" lang={addr ? "ko" : undefined}>{addr || t.card.noAddress}</p>
        {coord && <p className="text-xs text-gray-700">{D.coord} {coord}</p>}
        {lot.phone && <p className="text-sm">{D.phone} {lot.phone}</p>}
        <MapLinks lang={lang} links={links} addressText={addr} coordText={coord} />
      </section>

      <section className="mt-4" aria-labelledby="fee"><h2 id="fee" className="font-semibold">{D.fee}</h2>
        {fee && d.requestedPeriod ? (
          <>
            <p className="text-sm text-gray-700">{formatKst(d.requestedPeriod.startAt, lang)} ~ {formatKst(d.requestedPeriod.endAt, lang)}</p>
            <p className="text-lg font-bold">{fee.main}</p>{fee.sub && <p className="text-sm text-gray-700">{fee.sub}</p>}
            {d.fee?.status !== "OK" && d.lot.qualityFlags.includes("FEE_MIXED") && (
              <p className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-sm">{t.card.mixed}{d.lot.feeNote && <> {t.card.sourceNote} “<span lang="ko">{d.lot.feeNote}</span>”</>} {t.card.checkSite}</p>
            )}
            {d.fee?.status === "OK" && d.fee.assumptions?.map((a) => <p key={a} className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-sm">{domainText(a)}</p>)}
            {d.fee?.status === "OK" && d.fee.notes && <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">{d.fee.notes.map((n) => <li key={n}>{domainText(n)}</li>)}</ul>}
            {days.length > 0 && (days.length > 1 || days.some((x) => x.freeMinutes > 0 || x.capped)) && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm tabular-nums"><caption className="text-left text-xs text-gray-600">{D.dayCaption}</caption>
                  <thead><tr className="text-left text-gray-600">{D.dayCols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                  <tbody>{days.map((x) => (
                    <tr key={x.date}><td>{x.date.slice(5).replace("-", "/")}</td><td>{t.day[x.dayType]}</td><td>{hhmm(x.minutes)}</td><td>{x.freeMinutes > 0 ? hhmm(x.freeMinutes) : "-"}</td>
                      <td>{won(x.fee)}{x.capped && <span className="text-xs text-amber-800">{D.capped}</span>}</td></tr>))}</tbody>
                </table>
              </div>
            )}
            {d.feeWarnings.length > 0 && (
              <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900" role="note">
                <p className="font-semibold">{D.feeWarnTitle}</p>
                <ul className="list-disc pl-5">{d.feeWarnings.map((w) => <li key={w}>{t.anomaly[w]}</li>)}</ul>
                <p className="text-xs">{D.feeWarnNote}</p>
              </div>
            )}
            {d.cheaper.length > 0 && (
              <div className="mt-2 rounded border border-green-700 bg-green-50 p-2 text-sm" role="note">
                <p className="font-semibold text-green-900">{D.cheaperTitle}</p>
                <ul className="mt-1 space-y-0.5">
                  {d.cheaper.map((c) => {
                    const q = new URLSearchParams(sp as Record<string, string>); q.set("startAt", c.startAt); q.set("endAt", c.endAt);
                    const label = D.shift(c.shiftMinutes);
                    return <li key={c.shiftMinutes}><Link href={`/lots/${lot.id}?${q.toString()}`} className="underline">{label} ({formatKst(c.startAt, lang)} ~ {formatKst(c.endAt, lang)})</Link>: {c.fee === 0 ? t.fee.free : won(c.fee)} <span className="text-green-900">{D.save(won(c.saving))}</span></li>;
                  })}
                </ul>
                <p className="mt-1 text-xs text-gray-700">{D.cheaperNote}</p>
              </div>
            )}
            {d.feeCurve && <FeeCurve lang={lang} points={d.feeCurve} highlightHours={stayHours} />}
            {d.operating && <p className="mt-1 text-sm">{D.operating} {t.operating[d.operating]}{d.operatingAssumed && <span className="text-amber-800">{D.sundayAssumed}</span>}</p>}
          </>
        ) : <p className="text-sm">{D.needPeriod}</p>}
        <h3 className="mt-3 text-sm font-semibold">{D.rules}</h3>
        {d.feeRules.length === 0 ? <p className="text-sm">{D.noRules}</p> : (
          <table className="mt-1 w-full text-sm"><caption className="sr-only">{D.rules}</caption>
            <thead><tr className="text-left text-gray-600">{D.ruleCols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>{d.feeRules.map((r, i) => <tr key={i}><td>{t.rule[r.ruleType] ?? r.ruleType}</td><td>{t.day[r.dayType]}</td><td>{hm(r)}</td><td>{ruleText(r)}</td></tr>)}</tbody>
          </table>)}
      </section>

      {d.monthlyPass != null && (
        <section className="mt-4" aria-labelledby="pass-h"><h2 id="pass-h" className="font-semibold">{D.pass}</h2>
          <p className="text-sm">{won(d.monthlyPass)} <span className="text-xs text-gray-600">{D.passNote}</span></p>
          {d.passHint && <p className="mt-1 rounded bg-blue-50 p-2 text-sm">{d.passHint.kind === "CHEAPER" ? D.passCheaper(won(d.passHint.fee)) : D.passCheck}</p>}
        </section>
      )}
      {d.discounts.length > 0 && (
        <section className="mt-4" aria-labelledby="disc-h"><h2 id="disc-h" className="font-semibold">{D.disc}</h2>
          <p className="text-sm">{D.discTarget} {d.discounts.map(discountLabel).join(sep)}</p>
          {d.lot.feeNote && <p className="mt-1 text-sm text-gray-700">{t.card.sourceNote} &ldquo;<span lang="ko">{d.lot.feeNote}</span>&rdquo;</p>}
          <p className="mt-1 text-xs text-gray-600">{D.discNote}</p>
        </section>
      )}

      <ParkingTimerPanel lang={lang} lotId={lot.id} name={lot.name} rules={d.timer?.rules ?? null} holidays={d.timer?.holidays ?? null} />

      <section className="mt-4" aria-labelledby="op"><h2 id="op" className="font-semibold">{D.hours}</h2>
        {d.operatingSchedules.length === 0 ? <p className="text-sm">{D.noHours}</p> : (
          <ul className="text-sm">{d.operatingSchedules.map((o, i) => <li key={i}>{t.day[o.dayType]}: {o.closed ? D.closed : o.allDay ? D.h24 : `${o.openTime ?? "?"} ~ ${o.closeTime ?? "?"}`}{o.assumed && <span className="text-amber-800">{D.holidayAssumed}</span>}</li>)}</ul>)}
      </section>

      <section className="mt-4" aria-labelledby="sp"><h2 id="sp" className="font-semibold">{D.spaces}</h2>
        <p className="text-sm">{D.total(lot.totalSpaces != null ? t.spaces(lot.totalSpaces) : t.card.noInfo)}</p>
        <p className="text-sm">{D.live} {occ.main}{occ.sub ? ` (${occ.sub})` : ""}</p>
      </section>

      <section className="mt-4" aria-labelledby="src"><h2 id="src" className="font-semibold">{D.src}</h2>
        <p className="text-sm">{sourceLabel(d.source.name)}</p>
        <p className="text-xs text-gray-600">{D.srcDates(d.source.updatedAt ? formatKst(d.source.updatedAt, lang) : D.unverified, formatKst(d.source.collectedAt, lang))}</p>
        {d.source.notInLatestSync && <p role="status" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{D.notInSync}</p>}
        {d.holidayDataAvailable === false && <p className="text-xs text-amber-800">{D.noHoliday}</p>}
      </section>
      <ReportForm lang={lang} lotId={lot.id} />
    </>
  );
}
