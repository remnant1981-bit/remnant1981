import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppDb } from "@/server/app-db";
import { getLotDetail } from "@/server/search";
import { CopyButton } from "@/components/CopyButton";
import { DAY_LABEL, OPERATING_LABEL, OWNERSHIP_LABEL, RULE_LABEL, TYPE_LABEL, feeText, occupancyText, sourceLabel, won } from "@/lib/labels";
import { formatKst, parseOffsetIso } from "@/lib/time";

export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
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
  const hm = (r: { startTime: string | null; endTime: string | null }) => (r.startTime ? `${r.startTime}~${r.endTime}` : "종일");
  const ruleText = (r: (typeof d.feeRules)[number]) =>
    r.ruleType === "FREE" ? "무료" : r.amount == null ? "금액 미확인" : r.ruleType === "DAILY_MAX" ? won(r.amount) : `${r.durationMinutes ?? "?"}분당 ${won(r.amount)}`;
  return (
    <>
      <p><Link href="/" className="text-sm underline">← 처음으로</Link></p>
      <h1 className="mt-2 text-xl font-bold">{lot.name}</h1>
      <p className="text-sm text-gray-700">{TYPE_LABEL[lot.parkingType]} · {OWNERSHIP_LABEL[lot.ownershipType]}{lot.operatorName ? ` · ${lot.operatorName}` : ""}</p>

      <section className="mt-4" aria-labelledby="loc"><h2 id="loc" className="font-semibold">주소 및 위치</h2>
        <p className="text-sm">{addr || "주소 정보 없음"}</p>
        {coord && <p className="text-xs text-gray-700">좌표 {coord}</p>}
        {lot.phone && <p className="text-sm">전화 {lot.phone}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {addr && <CopyButton text={addr} label="주소 복사" />}
          {coord && <CopyButton text={coord} label="좌표 복사" />}
        </div>
        <p className="mt-2 text-xs text-gray-600">네이버 지도 앱 연동은 공식 문서 검증 전이라 준비 중입니다. 주소·좌표를 복사해 지도 앱에서 검색하세요.</p>
      </section>

      <section className="mt-4" aria-labelledby="fee"><h2 id="fee" className="font-semibold">예상 요금</h2>
        {fee && d.requestedPeriod ? (
          <>
            <p className="text-sm text-gray-700">{formatKst(d.requestedPeriod.startAt)} ~ {formatKst(d.requestedPeriod.endAt)}</p>
            <p className="text-lg font-bold">{fee.main}</p>{fee.sub && <p className="text-sm text-gray-700">{fee.sub}</p>}
            {d.fee?.status === "OK" && d.fee.notes && <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">{d.fee.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {d.operating && <p className="mt-1 text-sm">운영 상태(입·출차 시각 기준): {OPERATING_LABEL[d.operating]}</p>}
          </>
        ) : <p className="text-sm">주차 시작·종료 일시를 지정해 검색하면 예상 요금을 계산합니다.</p>}
        <h3 className="mt-3 text-sm font-semibold">요금 규칙</h3>
        {d.feeRules.length === 0 ? <p className="text-sm">요금 규칙 정보 없음 (무료 아님)</p> : (
          <table className="mt-1 w-full text-sm"><caption className="sr-only">요금 규칙</caption>
            <thead><tr className="text-left text-gray-600"><th scope="col">구분</th><th scope="col">적용</th><th scope="col">시간대</th><th scope="col">내용</th></tr></thead>
            <tbody>{d.feeRules.map((r, i) => <tr key={i}><td>{RULE_LABEL[r.ruleType] ?? r.ruleType}</td><td>{DAY_LABEL[r.dayType]}</td><td>{hm(r)}</td><td>{ruleText(r)}</td></tr>)}</tbody>
          </table>)}
      </section>

      <section className="mt-4" aria-labelledby="op"><h2 id="op" className="font-semibold">운영시간</h2>
        {d.operatingSchedules.length === 0 ? <p className="text-sm">운영시간 정보 없음 (24시간 운영 아님)</p> : (
          <ul className="text-sm">{d.operatingSchedules.map((o, i) => <li key={i}>{DAY_LABEL[o.dayType]}: {o.closed ? "휴무" : o.allDay ? "24시간" : `${o.openTime ?? "?"} ~ ${o.closeTime ?? "?"}`}</li>)}</ul>)}
      </section>

      <section className="mt-4" aria-labelledby="sp"><h2 id="sp" className="font-semibold">주차면수</h2>
        <p className="text-sm">전체 {lot.totalSpaces != null ? `${lot.totalSpaces}면` : "정보 없음"}</p>
        <p className="text-sm">실시간: {occ.main}{occ.sub ? ` (${occ.sub})` : ""}</p>
      </section>

      <section className="mt-4" aria-labelledby="src"><h2 id="src" className="font-semibold">데이터 출처</h2>
        <p className="text-sm">{sourceLabel(d.source.name)}</p>
        <p className="text-xs text-gray-600">원천 기준일 {d.source.updatedAt ? formatKst(d.source.updatedAt) : "미확인"} · 수집 {formatKst(d.source.collectedAt)}</p>
        {d.holidayDataAvailable === false && <p className="text-xs text-amber-800">입력 기간의 공휴일 데이터가 없어 요일별 규칙은 적용하지 않았습니다.</p>}
      </section>
    </>
  );
}
