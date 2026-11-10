// 한 번의 수집에서 같은 원천 관리번호가 반복될 때의 판정 (순수 함수).
// 실데이터(전국 18,994건 중 공영 노상/노외 17,084행) 확인:
//  - 반복 키 985개 중 567개(58%)는 행 사이 최대 거리 50m 이내 = 같은 장소의 이중 등록/버전(예: 같은 이름·좌표에 기준일만 다른 두 행)
//  - 325개(33%)는 500m 초과 = 서로 다른 장소가 한 번호를 공유(예: 한 기관이 노상 주차장 34곳을 같은 번호로 등록)
// 규칙(사용자 결정 2026-11-08을 '같은 장소'에 적용): 같은 장소는 기준일이 더 최신인 행(같으면 나중 행)만 반영, 다른 장소는 별도 시설로 모두 보존.
// 수집 순서와 무관하게 결과가 정해지도록 좌표순으로 묶는다.
import { distanceMeters } from "@/domain/geo";

export const SAME_PLACE_METERS = 50;

export interface Candidate<T> { key: string; lat: number | null; lng: number | null; date: string | null; seq: number; payload: T }
export interface Resolved<T> { id: string; item: Candidate<T>; collided: boolean }
export interface Resolution<T> {
  items: Array<Resolved<T>>;
  /** 같은 장소의 다른 버전이라 반영하지 않은 행 수 */
  superseded: number;
  /** 같은 번호를 공유하지만 다른 장소라 별도 시설로 보존한 수 */
  split: number;
}

// null은 뒤로
const cmp = (a: number | null, b: number | null) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : a - b);

export function resolveKeyCollisions<T>(input: Array<Candidate<T>>): Resolution<T> {
  const groups = new Map<string, Array<Candidate<T>>>();
  for (const c of input) { const g = groups.get(c.key); if (g) g.push(c); else groups.set(c.key, [c]); }
  const items: Array<Resolved<T>> = [];
  let superseded = 0, split = 0;
  for (const [key, g] of groups) {
    if (g.length === 1) { items.push({ id: key, item: g[0], collided: false }); continue; }
    const sorted = [...g].sort((a, b) => cmp(a.lat, b.lat) || cmp(a.lng, b.lng) || (a.date ?? "").localeCompare(b.date ?? "") || a.seq - b.seq);
    const clusters: Array<Array<Candidate<T>>> = [];
    for (const c of sorted) {
      // 좌표가 없는 행은 장소를 알 수 없으므로 첫 묶음에 합친다(정렬상 항상 뒤에 오므로 묶음이 이미 있다)
      const target = c.lat == null || c.lng == null
        ? clusters[0]
        : clusters.find((cl) => cl[0].lat != null && cl[0].lng != null && distanceMeters({ lat: cl[0].lat, lng: cl[0].lng }, { lat: c.lat!, lng: c.lng! }) <= SAME_PLACE_METERS);
      if (target) target.push(c); else clusters.push([c]);
    }
    const used = new Set<string>([key]);
    clusters.forEach((cl, idx) => {
      const winner = cl.reduce((w, c) => {
        const cd = c.date ?? "", wd = w.date ?? "";
        return cd > wd || (cd === wd && c.seq > w.seq) ? c : w;
      });
      superseded += cl.length - 1;
      if (idx > 0) split++;
      // 첫 묶음(좌표가 가장 작은 장소)이 원래 번호를 유지하고, 나머지는 장소(소수 3자리 ≈ 100m)를 덧붙여 구분한다
      // 50m 넘게 떨어진 두 장소가 같은 소수 3자리 칸(≈100m)에 들어갈 수 있어, 겹치면 정밀도를 올리고 그래도 겹치면 일련번호를 붙여 항상 유일하게 만든다
      let id = key;
      if (idx > 0) {
        const at = (d: number) => `${key}~${cl[0].lat?.toFixed(d) ?? "x"},${cl[0].lng?.toFixed(d) ?? "x"}`;
        id = at(3);
        if (used.has(id)) id = at(5);
        for (let n = 2; used.has(id); n++) id = `${at(5)}#${n}`;
      }
      used.add(id);
      items.push({ id, item: winner, collided: true });
    });
  }
  items.sort((a, b) => a.item.seq - b.item.seq);
  return { items, superseded, split };
}
