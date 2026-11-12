// 이용 시간별 요금 그래프(1~12시간, 서버 렌더 SVG). 단일 계열 막대 — 범례 없음(제목이 계열을 설명).
// 계산 불가 구간은 막대를 그리지 않고 '–'로 표시(0원으로 보이지 않게). 값은 막대에 마우스를 올리면(title) 보이고, 같은 값을 표로도 제공.
// 색은 globals.css 토큰(--chart-bar 등)을 사용해 다크 모드에서도 검증된 색으로 바뀜.

export interface CurvePoint { hours: number; fee: number | null; capped: boolean }

const W = 360, H = 190, PAD = { l: 44, r: 8, t: 22, b: 26 };
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** 깔끔한 눈금 최댓값(1·2·2.5·5 × 10^k) */
function niceMax(v: number): number {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p);
}

export function FeeCurve({ points, highlightHours }: { points: CurvePoint[]; highlightHours: number | null }) {
  const known = points.filter((p) => p.fee != null) as Array<CurvePoint & { fee: number }>;
  if (known.length === 0) return null; // 전 구간 계산 불가면 그래프를 그리지 않음(위 요금 안내로 충분)
  const top = niceMax(Math.max(...known.map((p) => p.fee)));
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const slot = plotW / points.length, barW = Math.max(6, slot - 6); // 막대 사이 간격으로 구분
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  const firstCap = points.find((p) => p.capped)?.hours ?? null;
  const last = [...known].pop()!;

  return (
    <figure className="mt-3">
      <figcaption className="text-sm font-semibold">이용 시간별 예상 요금 <span className="font-normal text-gray-600">(입력한 시작 시각부터, 가로축은 이용 시간)</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full max-w-md" role="img"
        aria-label={`1시간 ${known[0].hours === 1 ? won(known[0].fee) : "계산 불가"}부터 ${last.hours}시간 ${won(last.fee)}까지. 자세한 값은 아래 표`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} style={{ fill: "var(--chart-muted)" }}>{t >= 1000 ? `${(t / 1000).toLocaleString("ko-KR")}천` : t}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const label = <text x={cx} y={H - 9} textAnchor="middle" fontSize={10} style={{ fill: "var(--chart-muted)" }}>{p.hours}</text>;
          if (p.fee == null) {
            return <g key={p.hours}>{label}<text x={cx} y={PAD.t + plotH - 3} textAnchor="middle" fontSize={11} style={{ fill: "var(--chart-muted)" }}>–<title>{`${p.hours}시간: 계산 불가`}</title></text></g>;
          }
          const h = Math.max(p.fee > 0 ? 2 : 0, PAD.t + plotH - y(p.fee));
          const r = Math.min(4, barW / 2, h);
          const x0 = cx - barW / 2, yb = PAD.t + plotH, yt = yb - h;
          // 위쪽 모서리만 둥글게(데이터 끝), 기준선 쪽은 각지게
          const d = h <= 0 ? "" : `M${x0},${yb} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x0 + barW - r} Q${x0 + barW},${yt} ${x0 + barW},${yt + r} V${yb} Z`;
          const strong = highlightHours == null || highlightHours === p.hours;
          return (
            <g key={p.hours}>
              <title>{`${p.hours}시간: ${won(p.fee)}${p.capped ? " (일 최대요금 적용)" : ""}`}</title>
              <rect x={cx - slot / 2} y={PAD.t} width={slot} height={plotH} fill="transparent" />
              {d && <path d={d} style={{ fill: "var(--chart-bar)", opacity: strong ? 1 : 0.45 }} />}
              {p.fee === 0 && <text x={cx} y={yb - 3} textAnchor="middle" fontSize={9} style={{ fill: "var(--chart-muted)" }}>0</text>}
              {label}
            </g>
          );
        })}
        {/* 선택적 직접 라벨: 마지막 값, 그리고 일 최대요금이 처음 적용되는 지점 */}
        <text x={PAD.l + slot * (last.hours - 0.5)} y={Math.max(11, y(last.fee) - 5)} textAnchor="end" fontSize={11} fontWeight={600} style={{ fill: "var(--chart-ink)" }}>{won(last.fee)}</text>
        {firstCap != null && firstCap !== last.hours && (
          <text x={PAD.l + slot * (firstCap - 0.5)} y={Math.max(11, y(points[firstCap - 1].fee ?? 0) - 5)} textAnchor="middle" fontSize={10} style={{ fill: "var(--chart-muted)" }}>일 최대</text>
        )}
      </svg>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-gray-700 underline">표로 보기</summary>
        <table className="mt-1 text-sm tabular-nums"><caption className="sr-only">이용 시간별 예상 요금</caption>
          <thead><tr className="text-left text-gray-600"><th scope="col" className="pr-6">이용 시간</th><th scope="col">예상 요금</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.hours}><td className="pr-6">{p.hours}시간</td><td>{p.fee == null ? "계산 불가" : won(p.fee)}{p.capped ? " (일 최대 적용)" : ""}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
