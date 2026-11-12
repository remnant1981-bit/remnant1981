// 즐겨찾기·최근 검색: 이 기기의 브라우저(localStorage)에만 저장한다. 서버로 보내지 않는다(개인정보 최소 수집).
// 저장소가 막혀 있거나(사생활 보호 모드 등) 값이 깨져 있으면 빈 목록으로 동작한다.
import { useSyncExternalStore } from "react";

export interface FavoriteLot { id: number; name: string; address: string | null; savedAt: string }
export interface RecentSearch { query: string; label: string; period: string; savedAt: string }

const KEYS = { favorites: "parkingsave:favorites:v1", recent: "parkingsave:recent:v1" } as const;
export const MAX_FAVORITES = 30;
export const MAX_RECENT = 5;

const EMPTY: never[] = [];
const cache = new Map<string, { raw: string | null; value: unknown[] }>();
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function read<T>(key: string, guard: (x: unknown) => x is T): T[] {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T[]; // 같은 원문이면 같은 배열(useSyncExternalStore 무한 렌더 방지)
  let value: unknown[] = EMPTY;
  try { const v = raw ? JSON.parse(raw) : []; value = Array.isArray(v) ? v.filter(guard) : EMPTY; } catch { value = EMPTY; }
  cache.set(key, { raw, value });
  return value as T[];
}
function write(key: string, value: unknown[]) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경: 무시 */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith("parkingsave:")) l(); }; // 다른 탭의 변경 반영
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

const isFav = (x: unknown): x is FavoriteLot => !!x && typeof (x as FavoriteLot).id === "number" && typeof (x as FavoriteLot).name === "string";
const isRecent = (x: unknown): x is RecentSearch => !!x && typeof (x as RecentSearch).query === "string" && typeof (x as RecentSearch).label === "string";

export function getFavorites(): FavoriteLot[] { return read(KEYS.favorites, isFav); }
export function getRecent(): RecentSearch[] { return read(KEYS.recent, isRecent); }

export function toggleFavorite(lot: { id: number; name: string; address: string | null }, now = new Date()): boolean {
  const list = getFavorites();
  if (list.some((f) => f.id === lot.id)) { write(KEYS.favorites, list.filter((f) => f.id !== lot.id)); return false; }
  write(KEYS.favorites, [{ id: lot.id, name: lot.name.slice(0, 100), address: lot.address?.slice(0, 200) ?? null, savedAt: now.toISOString() }, ...list].slice(0, MAX_FAVORITES));
  return true;
}
export function removeFavorite(id: number) { write(KEYS.favorites, getFavorites().filter((f) => f.id !== id)); }

/** 같은 조건(쿼리)은 맨 앞으로 올리고 최대 5개 유지 */
export function recordSearch(s: Omit<RecentSearch, "savedAt">, now = new Date()) {
  const list = getRecent().filter((r) => r.query !== s.query);
  write(KEYS.recent, [{ ...s, query: s.query.slice(0, 500), label: s.label.slice(0, 100), savedAt: now.toISOString() }, ...list].slice(0, MAX_RECENT));
}
export function clearRecent() { write(KEYS.recent, []); }

const serverSnapshot = () => EMPTY;
export const useFavorites = () => useSyncExternalStore(subscribe, getFavorites, serverSnapshot);
export const useRecent = () => useSyncExternalStore(subscribe, getRecent, serverSnapshot);
