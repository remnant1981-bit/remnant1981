"use client";
import { useState } from "react";
import { toKstLocalInput } from "@/lib/time";

export interface FormDefaults {
  destination?: string; lat?: string; lng?: string; start?: string; end?: string;
  radiusMeters?: string; sort?: string; type?: string; freeOnly?: boolean; realtimeOnly?: boolean;
}
const QUICK = [1, 2, 3] as const;
const PLACES = ["서울시청", "광화문", "서울역", "을지로입구"];

export function SearchForm({ defaults = {}, places = PLACES }: { defaults?: FormDefaults; places?: string[] }) {
  const [start, setStart] = useState(defaults.start ?? "");
  const [end, setEnd] = useState(defaults.end ?? "");
  const [coords, setCoords] = useState<{ lat: string; lng: string } | null>(defaults.lat && defaults.lng ? { lat: defaults.lat, lng: defaults.lng } : null);
  const [geoMsg, setGeoMsg] = useState("");
  const [dest, setDest] = useState(defaults.destination ?? "");

  const quick = (h: number) => {
    if (!start) return;
    const ms = Date.parse(start + ":00+09:00");
    if (!Number.isNaN(ms)) setEnd(toKstLocalInput(ms + h * 3600_000));
  };
  const useLocation = () => {
    if (!navigator.geolocation) { setGeoMsg("이 브라우저는 위치 조회를 지원하지 않습니다. 목적지를 직접 입력하세요."); return; }
    setGeoMsg("위치 확인 중…");
    navigator.geolocation.getCurrentPosition(
      (p) => { // 정밀도 축소(소수 4자리 ≈ 11m)하여 URL에 담음. 서버에 저장하지 않음
        setCoords({ lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4) });
        setDest("");
        setGeoMsg("현재 위치를 사용합니다.");
      },
      (e) => {
        setCoords(null);
        setGeoMsg(e.code === e.PERMISSION_DENIED ? "위치 권한이 거부되었습니다. 목적지를 직접 입력해 검색하세요." : "위치를 가져오지 못했습니다. 목적지를 직접 입력하세요.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const field = "w-full rounded border border-gray-400 px-3 py-2 text-base";
  return (
    <form action="/search" method="get" className="space-y-4" aria-label="주차장 검색">
      <fieldset className="space-y-2">
        <legend className="font-semibold">어디에 주차할까요?</legend>
        <label htmlFor="destination" className="block text-sm">목적지</label>
        <input id="destination" name="destination" list="places" className={field} value={dest} placeholder="예: 서울시청"
          onChange={(e) => { setDest(e.target.value); if (e.target.value) setCoords(null); }} autoComplete="off" />
        <datalist id="places">{places.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={useLocation} className="rounded border border-gray-500 px-3 py-2 text-sm">현재 위치 사용</button>
          <span role="status" aria-live="polite" className="text-sm text-gray-700">{geoMsg}{coords && !geoMsg ? "현재 위치를 사용합니다." : ""}</span>
        </div>
        {coords && (<><input type="hidden" name="lat" value={coords.lat} /><input type="hidden" name="lng" value={coords.lng} /></>)}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">주차 시간 (한국 시간)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="start" className="block text-sm">시작 일시</label>
            <input id="start" name="start" type="datetime-local" required className={field} value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label htmlFor="end" className="block text-sm">종료 일시</label>
            <input id="end" name="end" type="datetime-local" required className={field} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="빠른 주차 시간 선택">
          {QUICK.map((h) => <button key={h} type="button" onClick={() => quick(h)} className="rounded border border-gray-500 px-3 py-1 text-sm">{h}시간</button>)}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold">조건</legend>
        <div><label htmlFor="radiusMeters" className="block text-sm">검색 반경</label>
          <select id="radiusMeters" name="radiusMeters" defaultValue={defaults.radiusMeters ?? "1000"} className={field}>
            {[500, 1000, 2000, 3000, 5000].map((r) => <option key={r} value={r}>{r >= 1000 ? `${r / 1000}km` : `${r}m`}</option>)}
          </select></div>
        <div><label htmlFor="type" className="block text-sm">시설 유형</label>
          <select id="type" name="type" defaultValue={defaults.type ?? "all"} className={field}>
            <option value="all">전체</option><option value="off_street">노외</option><option value="on_street">노상</option>
          </select></div>
        <div><label htmlFor="sort" className="block text-sm">정렬</label>
          <select id="sort" name="sort" defaultValue={defaults.sort ?? "free_first"} className={field}>
            <option value="free_first">무료 우선</option><option value="price_asc">요금 낮은 순</option>
            <option value="distance_asc">거리 가까운 순</option><option value="availability_desc">실시간 여유 순</option>
          </select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="freeOnly" value="true" defaultChecked={defaults.freeOnly} /> 무료만</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="realtimeOnly" value="true" defaultChecked={defaults.realtimeOnly} /> 실시간 잔여면수 확인 가능만</label>
      </fieldset>

      <button type="submit" className="w-full rounded bg-blue-700 px-4 py-3 text-base font-semibold text-white">주차장 검색</button>
    </form>
  );
}
