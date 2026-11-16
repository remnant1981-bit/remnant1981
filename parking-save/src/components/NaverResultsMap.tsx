"use client";
// 네이버 지도(JS SDK v3) 결과 지도. ResultsMap(Leaflet)과 같은 핀·묶기·팝업 규칙을 쓰고, SDK를 불러오지 못하거나 인증에 실패하면 Leaflet+OSM으로 대체한다.
// SDK 주소·인증 실패 콜백(window.navermap_authFailure)은 공식 문서 기준. ⚠ 실제 키로 미검증(가짜 SDK로 연결만 검증 — e2e/naver-map.spec.ts).
import { useEffect, useRef, useState } from "react";
import { clusterLabel, clusterPoints } from "@/domain/cluster";
import { NAVER_SDK_URL, type TileConfig } from "@/lib/map-tiles";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";
import { CLUSTER_PX, ResultsMap, clusterPopupEl, pinEl, popupEl, type MapItem } from "./ResultsMap";

/* 사용하는 SDK 범위만 최소로 타입 지정 */
type NLatLng = object;
interface NMap { getZoom(): number; getMaxZoom(): number; fitBounds(b: object, margin?: object): void; setCenter(c: NLatLng): void; setZoom(z: number): void; getProjection(): { fromCoordToOffset(c: NLatLng): { x: number; y: number }; fromOffsetToCoord(p: object): NLatLng }; destroy?(): void }
interface NOverlay { setMap(m: NMap | null): void }
interface NaverMaps {
  Map: new (el: HTMLElement, o: object) => NMap; LatLng: new (lat: number, lng: number) => NLatLng; LatLngBounds: new (sw: NLatLng, ne: NLatLng) => object & { extend(c: NLatLng): void };
  Marker: new (o: object) => NOverlay; Circle: new (o: object) => NOverlay; InfoWindow: new (o: object) => NOverlay & { open(m: NMap, anchor: NOverlay): void; close(): void };
  Point: new (x: number, y: number) => object; Event: { addListener(t: object, ev: string, fn: () => void): object; removeListener(l: object): void };
}
type Win = Window & { naver?: { maps: NaverMaps }; navermap_authFailure?: () => void };

let loading: Promise<NaverMaps> | null = null;
/** SDK를 한 번만 불러옴. 실패하면 다음 시도에서 다시 불러올 수 있게 초기화 */
function loadSdk(clientId: string): Promise<NaverMaps> {
  const w = window as Win;
  if (w.naver?.maps) return Promise.resolve(w.naver.maps);
  loading ??= new Promise<NaverMaps>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${NAVER_SDK_URL}?ncpKeyId=${encodeURIComponent(clientId)}`;
    s.async = true;
    s.onload = () => (w.naver?.maps ? resolve(w.naver.maps) : reject(new Error("SDK_EMPTY")));
    s.onerror = () => reject(new Error("SDK_LOAD"));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("SDK_TIMEOUT")), 10_000);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

export function NaverResultsMap({ clientId, fallback, center, radiusMeters, items, lang = "ko" }: { clientId: string; fallback: TileConfig; center: { lat: number; lng: number; label: string }; radiusMeters: number; items: MapItem[]; lang?: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const t = dict(lang).map;

  useEffect(() => {
    if (failed) return;
    let disposed = false;
    const overlays: NOverlay[] = [], pinLayer: NOverlay[] = [];
    let listener: object | null = null, map: NMap | null = null, nm: NaverMaps | null = null;
    const w = window as Win;
    w.navermap_authFailure = () => setFailed(true); // 공식 문서의 인증 실패 콜백

    loadSdk(clientId).then((N) => {
      if (disposed || !ref.current) return;
      nm = N;
      const C = new N.LatLng(center.lat, center.lng);
      const m = new N.Map(ref.current, { center: C, zoom: 15, scaleControl: true, mapDataControl: false });
      map = m;
      overlays.push(new N.Circle({ map: m, center: C, radius: radiusMeters, strokeColor: "#1d4ed8", strokeWeight: 1, fillColor: "#1d4ed8", fillOpacity: 0.04 }));
      overlays.push(new N.Marker({ map: m, position: C, title: `${t.center}: ${center.label}`, zIndex: 1 }));
      if (items.length > 0) {
        const b = new N.LatLngBounds(C, C);
        for (const it of items) b.extend(new N.LatLng(it.lat, it.lng));
        m.fitBounds(b, { top: 28, right: 28, bottom: 28, left: 28 });
      }
      const info = new N.InfoWindow({ content: "", borderWidth: 1 });
      // 화면 거리 기준 묶기(ResultsMap과 같은 규칙). 지도 이동·확대가 끝날 때마다 다시 묶음
      const draw = () => {
        pinLayer.splice(0).forEach((o) => o.setMap(null));
        const proj = m.getProjection();
        const screen = items.map((it) => { const p = proj.fromCoordToOffset(new N.LatLng(it.lat, it.lng)); return { x: p.x, y: p.y, item: it }; });
        for (const c of clusterPoints(screen, CLUSTER_PX)) {
          const single = c.items.length === 1;
          const it = c.items[0];
          const label = single ? it.feeLabel : clusterLabel(c.items, lang);
          const pos = single ? new N.LatLng(it.lat, it.lng) : proj.fromOffsetToCoord(new N.Point(c.x, c.y));
          const mk = new N.Marker({ map: m, position: pos, title: single ? `${it.name} ${it.feeLabel}` : `${label} — ${t.zoom}`,
            icon: { content: pinEl(single ? it : { tone: "paid", feeLabel: label }, !single), anchor: new N.Point(0, 0) } });
          pinLayer.push(mk);
          N.Event.addListener(mk, "click", () => {
            if (single) { (info as unknown as { setContent(c: HTMLElement): void }).setContent(popupEl(it)); info.open(m, mk); return; }
            if (m.getZoom() >= m.getMaxZoom() - 1) { (info as unknown as { setContent(c: HTMLElement): void }).setContent(clusterPopupEl(c.items)); info.open(m, mk); return; }
            const bb = new N.LatLngBounds(new N.LatLng(c.items[0].lat, c.items[0].lng), new N.LatLng(c.items[0].lat, c.items[0].lng));
            for (const x of c.items) bb.extend(new N.LatLng(x.lat, x.lng));
            m.fitBounds(bb, { top: 40, right: 40, bottom: 40, left: 40 });
          });
        }
      };
      draw();
      listener = N.Event.addListener(m, "idle", draw);
      overlays.push(info);
    }).catch(() => { if (!disposed) setFailed(true); });

    return () => {
      disposed = true;
      if (listener && nm) nm.Event.removeListener(listener);
      [...overlays, ...pinLayer].forEach((o) => o.setMap(null));
      map?.destroy?.();
    };
  }, [clientId, failed, center.lat, center.lng, center.label, radiusMeters, items, lang, t.center, t.zoom]);

  if (failed) return <ResultsMap lang={lang} tile={fallback} center={center} radiusMeters={radiusMeters} items={items} />;
  return (
    <div className="mt-4">
      <div ref={ref} data-map-provider="naver" className="h-[60vh] min-h-[320px] w-full rounded-lg border border-gray-300" role="region" aria-label={t.aria} />
      <p className="mt-1 text-xs text-gray-600">{t.note}</p>
    </div>
  );
}
