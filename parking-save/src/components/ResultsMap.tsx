"use client";
// 검색 결과 지도. 목록과 같은 결과를 핀으로 보여주는 보조 화면(정보는 모두 목록에도 있음).
// 지도 타일: OpenStreetMap(키 불필요, 출처 표시 필수, 대량 사용 금지 정책 — OPEN_ISSUES 기록). 네이버 지도 JS API로 바꿀 때 이 파일만 교체.
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { clusterLabel, clusterPoints } from "@/domain/cluster";
import type { TileConfig } from "@/lib/map-tiles";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";



export interface MapItem { id: number; name: string; lat: number; lng: number; feeLabel: string; tone: "free" | "paid" | "unknown"; amount: number | null; distanceLabel: string; href: string }

/** 이 거리(화면 px) 안의 핀은 하나로 묶어 표시 — 시설이 몰린 곳에서 요금 핀이 서로 가리는 문제 방지 */
const CLUSTER_PX = 64;

const TONE: Record<MapItem["tone"], { bg: string; fg: string; border: string }> = {
  free: { bg: "#e3f4ec", fg: "#0b5a3a", border: "#11724b" },
  paid: { bg: "#ffffff", fg: "#18202c", border: "#1d4ed8" },
  unknown: { bg: "#f1f3f6", fg: "#4b5563", border: "#9aa3b2" },
};

/** 핀 라벨 DOM(텍스트는 textContent로만 넣어 시설명·요금 문자열이 HTML로 해석되지 않게 함) */
function pinEl(item: Pick<MapItem, "tone" | "feeLabel">, cluster = false): HTMLElement {
  const t = cluster ? { bg: "#1d4ed8", fg: "#ffffff", border: "#1e3a8a" } : TONE[item.tone];
  const el = document.createElement("div");
  el.textContent = item.feeLabel;
  el.style.cssText = `display:inline-block;white-space:nowrap;padding:2px 7px;border-radius:999px;font:600 12px/1.4 system-ui,sans-serif;background:${t.bg};color:${t.fg};border:1.5px solid ${t.border};box-shadow:0 1px 2px rgba(0,0,0,.25);transform:translate(-50%,-100%)`;
  return el;
}
function clusterPopupEl(items: MapItem[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.style.cssText = "margin:0;padding-left:16px;max-height:180px;overflow:auto";
  for (const it of items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = it.href; a.textContent = it.name;
    li.append(a, document.createTextNode(` · ${it.feeLabel}`));
    ul.append(li);
  }
  return ul;
}
function popupEl(item: MapItem): HTMLElement {
  const box = document.createElement("div");
  const a = document.createElement("a");
  a.href = item.href; a.textContent = item.name; a.style.fontWeight = "600";
  const p = document.createElement("div");
  p.textContent = `${item.feeLabel} · ${item.distanceLabel}`;
  box.append(a, p);
  return box;
}

export function ResultsMap({ center, radiusMeters, items, tile, lang = "ko" }: { center: { lat: number; lng: number; label: string }; radiusMeters: number; items: MapItem[]; tile: TileConfig; lang?: Lang }) {
  const t = dict(lang).map;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(tile.url, { maxZoom: tile.maxZoom, attribution: tile.attribution }).addTo(map);
      L.circle([center.lat, center.lng], { radius: radiusMeters, color: "#1d4ed8", weight: 1, fillOpacity: 0.04 }).addTo(map);
      L.circleMarker([center.lat, center.lng], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#1d4ed8", fillOpacity: 1 })
        .addTo(map).bindTooltip(`${t.center}: ${center.label}`.replace(/[<>&]/g, ""));
      const pts: Array<[number, number]> = [[center.lat, center.lng], ...items.map((it) => [it.lat, it.lng] as [number, number])];
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 17 });
      else map.setView([center.lat, center.lng], 16);
      // 확대 수준마다 화면 거리 기준으로 다시 묶음. 최대 확대에서도 겹치면(같은 건물 등) 묶음 팝업에 목록 표시
      const layer = L.layerGroup().addTo(map);
      const m = map;
      const draw = () => {
        layer.clearLayers();
        const screen = items.map((it) => { const p = m.latLngToLayerPoint([it.lat, it.lng]); return { x: p.x, y: p.y, item: it }; });
        for (const c of clusterPoints(screen, CLUSTER_PX)) {
          if (c.items.length === 1) {
            const it = c.items[0];
            L.marker([it.lat, it.lng], { icon: L.divIcon({ html: pinEl(it), className: "", iconSize: [0, 0] }), keyboard: true, title: `${it.name} ${it.feeLabel}` })
              .addTo(layer).bindPopup(popupEl(it));
            continue;
          }
          const label = clusterLabel(c.items, lang);
          const at = m.layerPointToLatLng([c.x, c.y]);
          const mk = L.marker(at, { icon: L.divIcon({ html: pinEl({ tone: "paid", feeLabel: label }, true), className: "", iconSize: [0, 0] }), keyboard: true, title: `${label} — ${t.zoom}` }).addTo(layer);
          const bounds = L.latLngBounds(c.items.map((it) => [it.lat, it.lng] as [number, number]));
          if (m.getZoom() >= m.getMaxZoom() - 1 || bounds.getNorthEast().equals(bounds.getSouthWest())) mk.bindPopup(clusterPopupEl(c.items));
          else mk.on("click", () => m.fitBounds(bounds, { padding: [40, 40], maxZoom: m.getMaxZoom() }));
        }
      };
      draw();
      map.on("zoomend", draw);
    })();
    return () => { disposed = true; map?.remove(); };
  }, [center.lat, center.lng, center.label, radiusMeters, items, lang, t.center, t.zoom, tile.url, tile.maxZoom, tile.attribution]);

  return (
    <div className="mt-4">
      <div ref={ref} className="h-[60vh] min-h-[320px] w-full rounded-lg border border-gray-300" role="region" aria-label={t.aria} />
      <p className="mt-1 text-xs text-gray-600">{t.note}</p>
    </div>
  );
}
