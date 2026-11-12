// 비교 담기 목록(최대 3곳): 이 기기 브라우저에만 저장
import { useSyncExternalStore } from "react";

export interface CompareItem { id: number; name: string }
export const MAX_COMPARE = 3;
const KEY = "parkingsave:compare:v1";
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: CompareItem[] } = { raw: null, value: [] };
const EMPTY: CompareItem[] = [];

function readRaw(): string | null { try { return window.localStorage.getItem(KEY); } catch { return null; } }
export function getCompare(): CompareItem[] {
  const raw = readRaw();
  if (raw === cache.raw) return cache.value;
  let value: CompareItem[] = EMPTY;
  try { const v = raw ? JSON.parse(raw) : []; value = Array.isArray(v) ? v.filter((x) => x && typeof x.id === "number" && typeof x.name === "string").slice(0, MAX_COMPARE) : EMPTY; } catch { value = EMPTY; }
  cache = { raw, value };
  return value;
}
function write(v: CompareItem[]) { try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 저장 불가 */ } listeners.forEach((l) => l()); }
function subscribe(l: () => void) {
  listeners.add(l);
  const on = (e: StorageEvent) => { if (!e.key || e.key === KEY) l(); };
  window.addEventListener("storage", on);
  return () => { listeners.delete(l); window.removeEventListener("storage", on); };
}
export const useCompare = () => useSyncExternalStore(subscribe, getCompare, () => EMPTY);

/** 담기/빼기. 이미 3곳이면 담지 않고 false */
export function toggleCompare(item: CompareItem): boolean {
  const list = getCompare();
  if (list.some((x) => x.id === item.id)) { write(list.filter((x) => x.id !== item.id)); return true; }
  if (list.length >= MAX_COMPARE) return false;
  write([...list, { id: item.id, name: item.name.slice(0, 100) }]);
  return true;
}
export function clearCompare() { write([]); }
