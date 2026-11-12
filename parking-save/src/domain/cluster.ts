// 지도 핀 묶기(순수 함수). 화면 좌표(px)에서 서로 가까운 점을 탐욕적으로 묶는다.
// 같은 입력이면 항상 같은 결과(입력 순서대로 처리)라 테스트·렌더가 안정적이다.
export interface ScreenPoint<T> { x: number; y: number; item: T }
export interface Cluster<T> { x: number; y: number; items: T[] }

/** radiusPx 안의 점을 첫 점(앵커) 기준으로 묶는다. 묶음 좌표는 구성 점의 평균 */
export function clusterPoints<T>(points: Array<ScreenPoint<T>>, radiusPx: number): Array<Cluster<T>> {
  const out: Array<{ ax: number; ay: number; sx: number; sy: number; items: T[] }> = [];
  const r2 = radiusPx * radiusPx;
  for (const p of points) {
    const c = out.find((k) => (k.ax - p.x) ** 2 + (k.ay - p.y) ** 2 <= r2);
    if (c) { c.items.push(p.item); c.sx += p.x; c.sy += p.y; }
    else out.push({ ax: p.x, ay: p.y, sx: p.x, sy: p.y, items: [p.item] });
  }
  return out.map((c) => ({ x: c.sx / c.items.length, y: c.sy / c.items.length, items: c.items }));
}

/** 묶음 라벨: "N곳 · 무료 k · 최저 X원" 중 해당하는 것만 */
export function clusterLabel(items: Array<{ tone: "free" | "paid" | "unknown"; amount: number | null }>, lang: "ko" | "en" = "ko"): string {
  const free = items.filter((i) => i.tone === "free").length;
  const paid = items.filter((i) => i.tone === "paid" && i.amount != null).map((i) => i.amount!);
  const en = lang === "en";
  const parts = [en ? `${items.length} lots` : `${items.length}곳`];
  if (free > 0) parts.push(en ? `${free} free` : `무료 ${free}`);
  if (paid.length > 0) parts.push(en ? `from ₩${Math.min(...paid).toLocaleString("en-US")}` : `최저 ${Math.min(...paid).toLocaleString("ko-KR")}원`);
  return parts.join(" · ");
}
