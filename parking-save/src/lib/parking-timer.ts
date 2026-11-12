// 주차 타이머: "여기 주차 시작"부터 지금까지의 예상 요금과 다음 요금 인상 시각을 기기에서 계산.
// 이 기기의 브라우저에만 저장(서버 전송 없음). 요금 규칙·공휴일은 시작 시점에 받아 함께 저장한다.
import { useSyncExternalStore } from "react";
import { calculateFee, type FeeRule } from "@/domain/fee";
import { kstYmd } from "@/lib/time";

export interface TimerHolidays { from: string; to: string; dates: string[] }
export interface ParkingTimer { lotId: number; name: string; startedAt: string; rules: FeeRule[]; holidays: TimerHolidays | null }

const KEY = "parkingsave:timer:v1";
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ParkingTimer | null } = { raw: null, value: null };

function readRaw(): string | null { try { return window.localStorage.getItem(KEY); } catch { return null; } }
export function getTimer(): ParkingTimer | null {
  const raw = readRaw();
  if (raw === cache.raw) return cache.value;
  let value: ParkingTimer | null = null;
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.lotId === "number" && typeof v.name === "string" && !Number.isNaN(Date.parse(v.startedAt)) && Array.isArray(v.rules)) value = v;
  } catch { value = null; }
  cache = { raw, value };
  return value;
}
function write(v: ParkingTimer | null) {
  try { if (v) window.localStorage.setItem(KEY, JSON.stringify(v)); else window.localStorage.removeItem(KEY); } catch { /* 저장 불가 */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key === KEY) l(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}
export const useTimer = () => useSyncExternalStore(subscribe, getTimer, () => null);

export function startTimer(t: Omit<ParkingTimer, "startedAt">, at = new Date()) { write({ ...t, name: t.name.slice(0, 100), startedAt: at.toISOString() }); }
export function stopTimer() { write(null); }

/** 저장된 공휴일 범위 안이면 집합, 벗어나면 null(요일별 규칙은 판정 불가 — 요금 엔진 원칙과 동일) */
function holidaysFor(t: ParkingTimer, startMs: number, endMs: number): Set<string> | null {
  const h = t.holidays;
  if (!h) return null;
  return kstYmd(startMs) >= h.from && kstYmd(endMs - 1) <= h.to ? new Set(h.dates) : null;
}

export type TimerStatus =
  | { kind: "OK"; elapsedMin: number; fee: number; next: { at: number; fee: number } | null }
  | { kind: "UNKNOWN"; elapsedMin: number; reason: string };

/**
 * 지금까지의 예상 요금과 다음 인상 시점(최대 24시간 앞까지 1분 단위 탐색).
 * 1분 미만 경과는 1분으로 본다(입차 직후에도 기본요금이 보이도록).
 */
export function timerStatus(t: ParkingTimer, nowMs: number): TimerStatus {
  const s = Date.parse(t.startedAt);
  const end = Math.max(nowMs, s + 60_000);
  const elapsedMin = Math.max(0, Math.floor((nowMs - s) / 60_000));
  const at = (e: number) => calculateFee({ startAt: new Date(s), endAt: new Date(e), rules: t.rules, holidays: holidaysFor(t, s, e) });
  const cur = at(end);
  if (cur.status !== "OK") return { kind: "UNKNOWN", elapsedMin, reason: cur.detail };
  let next: { at: number; fee: number } | null = null;
  const base = Math.ceil(end / 60_000) * 60_000;
  for (let m = 1; m <= 24 * 60; m++) {
    const e = base + m * 60_000;
    const r = at(e);
    if (r.status !== "OK") break; // 이후 구간은 판정 불가 — 다음 인상 시각을 단정하지 않음
    if (r.amount > cur.amount) { next = { at: e - 60_000, fee: r.amount }; break; }
  }
  return { kind: "OK", elapsedMin, fee: cur.amount, next };
}
