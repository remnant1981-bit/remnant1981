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
