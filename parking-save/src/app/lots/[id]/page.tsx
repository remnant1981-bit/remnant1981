import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppDb } from "@/server/app-db";
import { getLotDetail } from "@/server/search";
import { MapLinks } from "@/components/MapLinks";
import { buildNaverLinks } from "@/domain/map-link";
import { isValidCoord } from "@/domain/geo";
import { DAY_LABEL, OPERATING_LABEL, OWNERSHIP_LABEL, RULE_LABEL, TYPE_LABEL, feeText, occupancyText, sourceLabel, won } from "@/lib/labels";
import { formatKst, parseOffsetIso } from "@/lib/time";
import { headers } from "next/headers";
import { clientKey, searchLimiter } from "@/server/rate-limit";
import { TooManyRequests } from "@/components/TooManyRequests";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ShareButton } from "@/components/ShareButton";
import type { DayBreakdown } from "@/domain/fee";
import { FeeCurve } from "@/components/FeeCurve";
import { ParkingTimerPanel } from "@/components/ParkingTimer";

export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const rl = searchLimiter.check(clientKey(await headers()));
  if (!rl.ok) return <TooManyRequests retryAfterSec={rl.retryAfterSec} />;
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
  const hhmm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);
  const hm = (r: { startTime: string | null; endTime: string | null }) => (r.startTime ? `${r.startTime}~${r.endTime}` : "종일");
  const ruleText = (r: (typeof d.feeRules)[number]) =>
    r.ruleType === "FREE" ? "무료" : r.amount == null ? "금액 미확인" : r.ruleType === "DAILY_MAX" ? won(r.amount) : `${r.durationMinutes ?? "?"}분당 ${won(r.amount)}`;
  return (
    <>
      <p><Link href="/" className="text-sm underline">← 처음으로</Link></p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-bold">{lot.name}</h1>
        <span className="flex flex-wrap items-center gap-2"><FavoriteButton id={lot.id} name={lot.name} address={addr || null} /><ShareButton title={`${lot.name} 주차 요금`} /></span>
      </div>
      <p className="text-sm text-gray-700">{TYPE_LABEL[lot.parkingType]} · {OWNERSHIP_LABEL[lot.ownershipType]}{lot.operatorName ? ` · ${lot.operatorName}` : ""}</p>

      <section className="mt-4" aria-labelledby="loc"><h2 id="loc" className="font-semibold">주소 및 위치</h2>
        <p className="text-sm">{addr || "주소 정보 없음"}</p>
        {coord && <p className="text-xs text-gray-700">좌표 {coord}</p>}
        {lot.phone && <p className="text-sm">전화 {lot.phone}</p>}
        <MapLinks links={links} addressText={addr} coordText={coord} />
      </section>

      <section className="mt-4" aria-labelledby="fee"><h2 id="fee" className="font-semibold">예상 요금</h2>
        {fee && d.requestedPeriod ? (
          <>
            <p className="text-sm text-gray-700">{formatKst(d.requestedPeriod.startAt)} ~ {formatKst(d.requestedPeriod.endAt)}</p>
            <p className="text-lg font-bold">{fee.main}</p>{fee.sub && <p className="text-sm text-gray-700">{fee.sub}</p>}
            {d.fee?.status !== "OK" && d.lot.qualityFlags.includes("FEE_MIXED") && (
              <p className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-sm">무료·유료 혼합 시설: 어느 시간대·구간이 무료인지 데이터에 없어 요금을 계산하지 않았습니다.{d.lot.feeNote && <> 원천 특기사항: “{d.lot.feeNote}”</>} 현장 안내를 확인하세요.</p>
            )}
            {d.fee?.status === "OK" && d.fee.assumptions?.map((a) => <p key={a} className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-sm">{a}</p>)}
            {d.fee?.status === "OK" && d.fee.notes && <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">{d.fee.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {days.length > 0 && (days.length > 1 || days.some((x) => x.freeMinutes > 0 || x.capped)) && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm tabular-nums"><caption className="text-left text-xs text-gray-600">날짜별 요금 내역 (한국 시간 기준, 단위 시간 올림은 전체 이용 시간 누적 기준)</caption>
                  <thead><tr className="text-left text-gray-600"><th scope="col">날짜</th><th scope="col">구분</th><th scope="col">이용</th><th scope="col">무료</th><th scope="col">요금</th></tr></thead>
                  <tbody>{days.map((x) => (
                    <tr key={x.date}><td>{x.date.slice(5).replace("-", "/")}</td><td>{DAY_LABEL[x.dayType]}</td><td>{hhmm(x.minutes)}</td><td>{x.freeMinutes > 0 ? hhmm(x.freeMinutes) : "-"}</td>
                      <td>{won(x.fee)}{x.capped && <span className="text-xs text-amber-800"> (일 최대 적용)</span>}</td></tr>))}</tbody>
                </table>
              </div>
            )}
            {d.feeCurve && <FeeCurve points={d.feeCurve} highlightHours={stayHours} />}
            {d.operating && <p className="mt-1 text-sm">운영 상태(이용 시간 전체 기준): {OPERATING_LABEL[d.operating]}{d.operatingAssumed && <span className="text-amber-800"> (일요일은 공휴일 규칙 적용 · 추정)</span>}</p>}
          </>
        ) : <p className="text-sm">주차 시작·종료 일시를 지정해 검색하면 예상 요금을 계산합니다.</p>}
        <h3 className="mt-3 text-sm font-semibold">요금 규칙</h3>
        {d.feeRules.length === 0 ? <p className="text-sm">요금 규칙 정보 없음 (무료 아님)</p> : (
          <table className="mt-1 w-full text-sm"><caption className="sr-only">요금 규칙</caption>
            <thead><tr className="text-left text-gray-600"><th scope="col">구분</th><th scope="col">적용</th><th scope="col">시간대</th><th scope="col">내용</th></tr></thead>
            <tbody>{d.feeRules.map((r, i) => <tr key={i}><td>{RULE_LABEL[r.ruleType] ?? r.ruleType}</td><td>{DAY_LABEL[r.dayType]}</td><td>{hm(r)}</td><td>{ruleText(r)}</td></tr>)}</tbody>
          </table>)}
      </section>

      <ParkingTimerPanel lotId={lot.id} name={lot.name} rules={d.timer?.rules ?? null} holidays={d.timer?.holidays ?? null} />

      <section className="mt-4" aria-labelledby="op"><h2 id="op" className="font-semibold">운영시간</h2>
        {d.operatingSchedules.length === 0 ? <p className="text-sm">운영시간 정보 없음 (24시간 운영 아님)</p> : (
          <ul className="text-sm">{d.operatingSchedules.map((o, i) => <li key={i}>{DAY_LABEL[o.dayType]}: {o.closed ? "휴무" : o.allDay ? "24시간" : `${o.openTime ?? "?"} ~ ${o.closeTime ?? "?"}`}{o.assumed && <span className="text-amber-800"> (공휴일 규칙 적용 · 추정)</span>}</li>)}</ul>)}
      </section>

      <section className="mt-4" aria-labelledby="sp"><h2 id="sp" className="font-semibold">주차면수</h2>
        <p className="text-sm">전체 {lot.totalSpaces != null ? `${lot.totalSpaces}면` : "정보 없음"}</p>
        <p className="text-sm">실시간: {occ.main}{occ.sub ? ` (${occ.sub})` : ""}</p>
      </section>

      <section className="mt-4" aria-labelledby="src"><h2 id="src" className="font-semibold">데이터 출처</h2>
        <p className="text-sm">{sourceLabel(d.source.name)}</p>
        <p className="text-xs text-gray-600">원천 기준일 {d.source.updatedAt ? formatKst(d.source.updatedAt) : "미확인"} · 수집 {formatKst(d.source.collectedAt)}</p>
        {d.source.notInLatestSync && <p role="status" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">최근 수집에서 이 시설이 확인되지 않았습니다. 폐쇄되었거나 정보가 바뀌었을 수 있으니 현장 확인이 필요합니다.</p>}
        {d.holidayDataAvailable === false && <p className="text-xs text-amber-800">입력 기간의 공휴일 데이터가 없어 요일별 규칙은 적용하지 않았습니다.</p>}
      </section>
    </>
  );
}
