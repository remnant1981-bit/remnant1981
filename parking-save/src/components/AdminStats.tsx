"use client";
// 관리자 운영 현황: 오늘·최근 7일 요약 타일 + 30일 일별 작은 막대 그래프(검색·상세 조회·오류·요청 제한·신고).
// 색은 globals.css 차트 토큰(--chart-bar 등) — 다크 모드에서도 같은 기준. 값은 막대에 마우스를 올리면(title) 보이고 표로도 제공.
import { useEffect, useState } from "react";

type Day = { ymd: string; search_page?: number; search_api?: number; lot_view?: number; error?: number; rate_limited?: number; search_cache_hit?: number; reports_received: number };
type Stats = { days: Day[]; freshness: { standardLastSuccess: string | null; standardAgeHours: number | null }; counts: { lots: number; pending: number; overrides: number } };
const n = (v: number | undefined) => v ?? 0;
const SERIES: Array<{ key: string; label: string; value: (d: Day) => number; alert?: boolean }> = [
  { key: "search", label: "검색(화면+API)", value: (d) => n(d.search_page) + n(d.search_api) },
  { key: "lot", label: "주차장 상세 조회", value: (d) => n(d.lot_view) },
  { key: "report", label: "정보 오류 신고 접수", value: (d) => d.reports_received },
  { key: "error", label: "서버 오류", value: (d) => n(d.error), alert: true },
  { key: "limited", label: "요청 제한(429)", value: (d) => n(d.rate_limited), alert: true },
];

function Spark({ days, value, label, alert }: { days: Day[]; value: (d: Day) => number; label: string; alert?: boolean }) {
  const W = 300, H = 64, P = 2, vals = days.map(value), max = Math.max(1, ...vals), slot = (W - P * 2) / vals.length, bw = Math.max(2, slot - 2);
  const total = vals.reduce((a, b) => a + b, 0), today = vals[vals.length - 1];
  return (
    <figure className="m-0 rounded border border-gray-300 p-2">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-gray-700"><span>{label}</span><span className="tabular-nums">오늘 <b>{today.toLocaleString("ko-KR")}</b> · 30일 {total.toLocaleString("ko-KR")}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${label} 최근 30일, 최대 ${max}건, 오늘 ${today}건`}>
        <line x1={P} x2={W - P} y1={H - 1} y2={H - 1} style={{ stroke: "var(--chart-grid)" }} />
        {vals.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(2, (v / max) * (H - 8));
          return <rect key={days[i].ymd} x={P + slot * i} y={H - 1 - h} width={bw} height={h} rx={1}
            style={{ fill: alert && v > 0 ? "var(--chart-alert)" : "var(--chart-bar)", opacity: i === vals.length - 1 ? 1 : 0.75 }}><title>{`${days[i].ymd}: ${v}건`}</title></rect>;
        })}
      </svg>
    </figure>
  );
}

export function AdminStats({ call }: { call: (path: string) => Promise<Stats> }) {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { let alive = true; call("/api/admin/stats").then((d) => { if (alive) setS(d); }, (e: Error) => { if (alive) setErr(e.message); }); return () => { alive = false; }; }, [call]);
  if (err) return <p role="alert" className="text-sm text-red-900">{err}</p>;
  if (!s) return <p role="status" className="text-sm text-gray-700">불러오는 중…</p>;
  const last7 = s.days.slice(-7);
  const sum = (f: (d: Day) => number, ds = last7) => ds.reduce((a, d) => a + f(d), 0);
  const searches7 = sum((d) => n(d.search_page) + n(d.search_api)), hits7 = sum((d) => n(d.search_cache_hit));
  const age = s.freshness.standardAgeHours;
  const tiles: Array<[string, string, boolean]> = [
    ["최근 7일 검색", searches7.toLocaleString("ko-KR"), false],
    ["캐시 응답 비율(7일)", searches7 ? `${Math.round((hits7 / searches7) * 100)}%` : "-", false],
    ["검토 대기 신고", `${s.counts.pending}건`, s.counts.pending > 0],
    ["적용 중 보정", `${s.counts.overrides}건`, false],
    ["표준데이터 마지막 수집", age == null ? "없음" : `${age}시간 전`, age == null || age > 50],
    ["서비스 시설 수", s.counts.lots.toLocaleString("ko-KR"), false],
  ];
  return (
    <div className="mt-2 space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, v, warn]) => (
          <div key={k} className={`rounded border p-2 ${warn ? "border-amber-500 bg-amber-50" : "border-gray-300"}`}>
            <dt className="text-xs text-gray-700">{k}</dt><dd className="text-lg font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 sm:grid-cols-2">{SERIES.map((x) => <Spark key={x.key} days={s.days} value={x.value} label={x.label} alert={x.alert} />)}</div>
      <details className="text-sm"><summary className="cursor-pointer underline">표로 보기(최근 14일)</summary>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="일별 운영 현황 표(가로 스크롤)"><table className="mt-1 w-full min-w-[480px] text-xs tabular-nums"><caption className="sr-only">일별 운영 현황</caption>
          <thead><tr className="text-left text-gray-600"><th scope="col">날짜</th>{SERIES.map((x) => <th key={x.key} scope="col">{x.label}</th>)}</tr></thead>
          <tbody>{s.days.slice(-14).reverse().map((d) => <tr key={d.ymd}><td className="whitespace-nowrap pr-2">{d.ymd}</td>{SERIES.map((x) => <td key={x.key}>{x.value(d)}</td>)}</tr>)}</tbody></table></div>
      </details>
      <p className="text-xs text-gray-600">일별 합계만 저장하며 IP·위치·검색어는 기록하지 않습니다. 1분 단위로 모아 저장하므로 서버 재시작 직전 1분은 빠질 수 있습니다.</p>
    </div>
  );
}
