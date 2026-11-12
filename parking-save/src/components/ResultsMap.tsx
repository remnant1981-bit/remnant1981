"use client";
// 검색 결과 지도. 목록과 같은 결과를 핀으로 보여주는 보조 화면(정보는 모두 목록에도 있음).
// 지도 타일: OpenStreetMap(키 불필요, 출처 표시 필수, 대량 사용 금지 정책 — OPEN_ISSUES 기록). 네이버 지도 JS API로 바꿀 때 이 파일만 교체.
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export interface MapItem { id: number; name: string; lat: number; lng: number; feeLabel: string; tone: "free" | "paid" | "unknown"; distanceLabel: string; href: string }

const TONE: Record<MapItem["tone"], { bg: string; fg: string; border: string }> = {
  free: { bg: "#e3f4ec", fg: "#0b5a3a", border: "#11724b" },
  paid: { bg: "#ffffff", fg: "#18202c", border: "#1d4ed8" },
  unknown: { bg: "#f1f3f6", fg: "#4b5563", border: "#9aa3b2" },
};

/** 핀 라벨 DOM(텍스트는 textContent로만 넣어 시설명·요금 문자열이 HTML로 해석되지 않게 함) */
function pinEl(item: MapItem): HTMLElement {
  const t = TONE[item.tone];
  const el = document.createElement("div");
  el.textContent = item.feeLabel;
  el.style.cssText = `display:inline-block;white-space:nowrap;padding:2px 7px;border-radius:999px;font:600 12px/1.4 system-ui,sans-serif;background:${t.bg};color:${t.fg};border:1.5px solid ${t.border};box-shadow:0 1px 2px rgba(0,0,0,.25);transform:translate(-50%,-100%)`;
  return el;
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

export function ResultsMap({ center, radiusMeters, items }: { center: { lat: number; lng: number; label: string }; radiusMeters: number; items: MapItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
      L.circle([center.lat, center.lng], { radius: radiusMeters, color: "#1d4ed8", weight: 1, fillOpacity: 0.04 }).addTo(map);
      L.circleMarker([center.lat, center.lng], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#1d4ed8", fillOpacity: 1 })
        .addTo(map).bindTooltip(`검색 중심: ${center.label}`.replace(/[<>&]/g, ""));
      const pts: Array<[number, number]> = [[center.lat, center.lng]];
      for (const it of items) {
        L.marker([it.lat, it.lng], { icon: L.divIcon({ html: pinEl(it), className: "", iconSize: [0, 0] }), keyboard: true, title: `${it.name} ${it.feeLabel}` })
          .addTo(map).bindPopup(popupEl(it));
        pts.push([it.lat, it.lng]);
      }
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 17 });
      else map.setView([center.lat, center.lng], 16);
    })();
    return () => { disposed = true; map?.remove(); };
  }, [center.lat, center.lng, center.label, radiusMeters, items]);

  return (
    <div className="mt-4">
      <div ref={ref} className="h-[60vh] min-h-[320px] w-full rounded-lg border border-gray-300" role="region" aria-label="검색 결과 지도 (아래 목록과 같은 결과)" />
      <p className="mt-1 text-xs text-gray-600">핀의 금액은 입력한 시간 기준 예상 요금입니다. ‘?’는 요금을 계산할 수 없는 시설입니다. 지도는 목록과 같은 결과를 보여줍니다.</p>
    </div>
  );
}
