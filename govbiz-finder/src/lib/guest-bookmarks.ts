"use client";
// 게스트 관심 공고: 이 브라우저(localStorage)에만 보관. 서버 전송 없음.
export interface GuestMark { id: string; title: string; organization: string; end: string | null; savedAt: string }
const KEY = "gbf_guest_bookmarks";
const EVT = "gbf-guest-bookmarks";
const EMPTY: GuestMark[] = [];
let cacheRaw: string | null = null;
let cache: GuestMark[] = EMPTY;

export function readGuestMarks(): GuestMark[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return EMPTY; }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try { const v = raw ? JSON.parse(raw) : []; cache = Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string").slice(0, 300) : EMPTY; } catch { cache = EMPTY; }
  return cache;
}
function write(list: GuestMark[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300))); } catch { /* 저장 불가 환경 무시 */ }
  window.dispatchEvent(new Event(EVT));
}
export function toggleGuestMark(m: Omit<GuestMark, "savedAt">): boolean {
  const cur = readGuestMarks();
  if (cur.some((x) => x.id === m.id)) { write(cur.filter((x) => x.id !== m.id)); return false; }
  write([{ ...m, savedAt: new Date().toISOString() }, ...cur]);
  return true;
}
export function clearGuestMarks() { write([]); }
export function subscribeGuestMarks(cb: () => void) {
  window.addEventListener(EVT, cb); window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVT, cb); window.removeEventListener("storage", cb); };
}
export const serverGuestMarks = () => EMPTY;

/** 서울 기준 오늘(YYYY-MM-DD) */
export function seoulTodayClient(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
/** 마감까지 남은 일수(마감일 없거나 형식 오류면 null) */
export function daysLeft(end: string | null, today = seoulTodayClient()): number | null {
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
}
