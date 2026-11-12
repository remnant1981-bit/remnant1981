// 주차 타이머: "여기 주차 시작"부터 지금까지의 예상 요금과 다음 요금 인상 시각을 기기에서 계산.
// 이 기기의 브라우저에만 저장(서버 전송 없음). 요금 규칙·공휴일은 시작 시점에 받아 함께 저장한다.
import { useSyncExternalStore } from "react";
import { calculateFee, type FeeRule } from "@/domain/fee";
import { operatingAt, type ScheduleRow } from "@/domain/operating";
import { kstYmd } from "@/lib/time";

export interface TimerHolidays { from: string; to: string; dates: string[] }
/** schedules: 운영 종료 알림용(이전 버전 저장분에는 없을 수 있음) */
export interface ParkingTimer { lotId: number; name: string; startedAt: string; rules: FeeRule[]; holidays: TimerHolidays | null; schedules?: ScheduleRow[] }

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
  | { kind: "UNKNOWN"; elapsedMin: number; reason: string; code: string };

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
  if (cur.status !== "OK") return { kind: "UNKNOWN", elapsedMin, reason: cur.detail, code: cur.reason };
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

/** 알림 시점: 요금 인상 10분 전, 운영 종료 30분 전 */
export const ALERT_LEAD_MIN = { FEE_UP: 10, CLOSING: 30 } as const;
export interface TimerAlert { kind: "FEE_UP" | "CLOSING"; at: number; notifyAt: number; fee?: number }

/**
 * 운영 종료 시각: 지금 운영 중일 때, 24시간 안에 처음 '운영 외'가 되는 시각(5분 간격 탐색 후 1분 단위로 좁힘).
 * 운영시간 정보가 없거나 판정 불가(UNKNOWN)가 끼면 null — 종료 시각을 단정하지 않음.
 */
export function nextClosingAt(t: ParkingTimer, nowMs: number): number | null {
  const rows = t.schedules;
  if (!rows?.length) return null;
  const st = (ms: number) => operatingAt(rows, ms, holidaysFor(t, ms, ms + 1));
  if (st(nowMs) !== "OPERATING") return null;
  for (let ms = nowMs + 5 * 60_000; ms <= nowMs + 24 * 3600_000; ms += 5 * 60_000) {
    const s = st(ms);
    if (s === "UNKNOWN") return null;
    if (s === "OUTSIDE") {
      let at = ms;
      for (let m = ms - 4 * 60_000; m < ms; m += 60_000) if (st(m) === "OUTSIDE") { at = m; break; }
      return Math.floor(at / 60_000) * 60_000;
    }
  }
  return null;
}

/** 앞으로 보낼 알림 목록(이미 지난 사건은 제외). 요금을 계산할 수 없으면 인상 알림 없음 */
export function timerAlerts(t: ParkingTimer, nowMs: number): TimerAlert[] {
  const out: TimerAlert[] = [];
  const st = timerStatus(t, nowMs);
  if (st.kind === "OK" && st.next) out.push({ kind: "FEE_UP", at: st.next.at, notifyAt: st.next.at - ALERT_LEAD_MIN.FEE_UP * 60_000, fee: st.next.fee });
  const close = nextClosingAt(t, nowMs);
  if (close != null) out.push({ kind: "CLOSING", at: close, notifyAt: close - ALERT_LEAD_MIN.CLOSING * 60_000 });
  return out.filter((a) => a.at > nowMs).sort((a, b) => a.notifyAt - b.notifyAt);
}

// 알림 받기 설정(이 기기에만). 브라우저 알림 권한과 별개로 사용자가 끌 수 있게 함
const ALERT_KEY = "parkingsave:timer-alerts:v1";
const alertListeners = new Set<() => void>();
export function getAlertsOn(): boolean { try { return window.localStorage.getItem(ALERT_KEY) === "1"; } catch { return false; } }
export function setAlertsOn(on: boolean) { try { if (on) window.localStorage.setItem(ALERT_KEY, "1"); else window.localStorage.removeItem(ALERT_KEY); } catch { /* 저장 불가 */ } alertListeners.forEach((l) => l()); }
export const useAlertsOn = () => useSyncExternalStore((l) => { alertListeners.add(l); return () => { alertListeners.delete(l); }; }, getAlertsOn, () => false);
