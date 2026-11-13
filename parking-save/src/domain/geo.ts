export interface LatLng { lat: number; lng: number }

export function isValidCoord(p: { lat: unknown; lng: unknown }): boolean {
  return typeof p.lat === "number" && typeof p.lng === "number" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}

/** 두 지점 간 직선(대원) 거리, 미터 (haversine). 도로 거리가 아님 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 도보 시간 추정에 쓰는 가정(임시값 — OPEN_ISSUES): 실제 보행 경로는 직선의 약 1.3배, 보행 속도 분속 67m(시속 4km) */
export const WALK_DETOUR_FACTOR = 1.3;
export const WALK_METERS_PER_MIN = 67;
/** 직선거리 → 도보 시간(분) 추정. 경로 탐색이 아니므로 화면에 '추정'으로 표시한다 */
export function walkMinutesEstimate(straightMeters: number): number {
  return Math.max(1, Math.round((straightMeters * WALK_DETOUR_FACTOR) / WALK_METERS_PER_MIN));
}
