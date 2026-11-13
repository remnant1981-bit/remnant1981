// 공유 미리보기 이미지(1200×630) 공통 틀. next/og(satori)는 한글 글꼴이 없으면 글자가 빠지므로 Pretendard 서브셋을 읽어 넣는다.
// 글꼴 파일이 없으면(이미지 빌드 누락 등) 글꼴 없이 그리되 오류로 죽지 않게 한다.
import fs from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { logError } from "./log";

export const OG_SIZE = { width: 1200, height: 630 };
let font: Promise<ArrayBuffer | null> | null = null;
function loadFont(): Promise<ArrayBuffer | null> {
  font ??= fs.readFile(path.join(process.cwd(), "assets/fonts/Pretendard-Bold.subset.woff"))
    .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
    .catch((e) => { logError("og.font_missing", e); return null; });
  return font;
}

export interface OgCard { kicker: string; title: string; lines: string[]; badge?: { text: string; tone: "free" | "paid" | "unknown" }; footer: string }
const TONE = { free: { bg: "#e3f4ec", fg: "#0b5a3a" }, paid: { bg: "#e6edfc", fg: "#1d3a8a" }, unknown: { bg: "#f1f3f6", fg: "#4b5563" } };

export async function ogImage(c: OgCard): Promise<ImageResponse> {
  const f = await loadFont();
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#ffffff", color: "#18202c", fontFamily: "Pretendard" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 14, background: "#1d4ed8", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44 }}>P</div>
          <div style={{ fontSize: 34, color: "#1d4ed8" }}>{c.kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: c.title.length > 18 ? 60 : 72, lineHeight: 1.15 }}>{clip(c.title, 34)}</div>
          {c.lines.map((l) => <div key={l} style={{ fontSize: 32, color: "#586273" }}>{clip(l, 48)}</div>)}
          {c.badge && <div style={{ display: "flex" }}><div style={{ fontSize: 44, padding: "10px 26px", borderRadius: 999, background: TONE[c.badge.tone].bg, color: TONE[c.badge.tone].fg }}>{c.badge.text}</div></div>}
        </div>
        <div style={{ fontSize: 24, color: "#586273" }}>{c.footer}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: f ? [{ name: "Pretendard", data: f, weight: 700, style: "normal" }] : [], headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

// 렌더링 결과 캐시(시설별 PNG, 1시간, 최대 300장). 같은 링크가 여러 번 공유·수집될 때 다시 그리지 않는다
const CACHE_TTL_MS = 3600_000, CACHE_MAX = 300;
const pngCache = new Map<string, { at: number; png: ArrayBuffer }>();
export const ogCacheStats = { hits: 0, misses: 0 };
export function resetOgCacheForTest() { pngCache.clear(); ogCacheStats.hits = 0; ogCacheStats.misses = 0; }
const pngResponse = (png: ArrayBuffer) => new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });

export async function ogImageCached(key: string, render: () => Promise<OgCard>, now = Date.now()): Promise<Response> {
  const hit = pngCache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) { ogCacheStats.hits++; return pngResponse(hit.png); }
  ogCacheStats.misses++;
  const png = await (await ogImage(await render())).arrayBuffer();
  pngCache.delete(key); pngCache.set(key, { at: now, png });
  while (pngCache.size > CACHE_MAX) pngCache.delete(pngCache.keys().next().value!);
  return pngResponse(png);
}
/** 요청 제한 초과 응답(이미지 대신) */
export const ogTooMany = (retryAfterSec: number) => new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(retryAfterSec), "Cache-Control": "no-store" } });
