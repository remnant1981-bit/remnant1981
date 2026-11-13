"use client";
import { useState } from "react";
import { toKstLocalInput } from "@/lib/time";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";

export interface FormDefaults {
  destination?: string; lat?: string; lng?: string; start?: string; end?: string;
  radiusMeters?: string; sort?: string; type?: string; freeOnly?: boolean; realtimeOnly?: boolean; operatingOnly?: boolean;
}
const QUICK = [1, 2, 3] as const;
const PLACES = ["서울시청", "광화문", "서울역", "을지로입구"];

export function SearchForm({ defaults = {}, places = PLACES, lang = "ko" }: { defaults?: FormDefaults; places?: string[]; lang?: Lang }) {
  const t = dict(lang), f = t.form;
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
    if (!navigator.geolocation) { setGeoMsg(f.geoUnsupported); return; }
    setGeoMsg(f.geoLoading);
    navigator.geolocation.getCurrentPosition(
      (p) => { // 정밀도 축소(소수 4자리 ≈ 11m)하여 URL에 담음. 서버에 저장하지 않음
        setCoords({ lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4) });
        setDest("");
        setGeoMsg(f.geoOk);
      },
      (e) => {
        setCoords(null);
        setGeoMsg(e.code === e.PERMISSION_DENIED ? f.geoDenied : f.geoFail);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const field = "w-full rounded border border-gray-400 px-3 py-2 text-base";
  return (
    <form action="/search" method="get" className="space-y-4" aria-label={f.aria}>
      <fieldset className="space-y-2">
        <legend className="font-semibold">{f.where}</legend>
        <label htmlFor="destination" className="block text-sm">{f.destination}</label>
        <input id="destination" name="destination" list="places" aria-describedby="dest-hint" className={field} value={dest} placeholder={f.placeholder(places[0] ?? null)}
          onChange={(e) => { setDest(e.target.value); if (e.target.value) setCoords(null); }} autoComplete="off" />
        <p id="dest-hint" className="text-xs text-gray-600">{f.destHint}</p>
        <datalist id="places">{places.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={useLocation} className="rounded border border-gray-500 px-3 py-2 text-sm">{f.useLocation}</button>
          <span role="status" aria-live="polite" className="text-sm text-gray-700">{geoMsg}{coords && !geoMsg ? f.geoOk : ""}</span>
        </div>
        {coords && (<><input type="hidden" name="lat" value={coords.lat} /><input type="hidden" name="lng" value={coords.lng} /></>)}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">{f.when}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="start" className="block text-sm">{f.start}</label>
            <input id="start" name="start" type="datetime-local" required className={field} value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label htmlFor="end" className="block text-sm">{f.end}</label>
            <input id="end" name="end" type="datetime-local" required min={start || undefined} className={field} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={f.quickAria}>
          {QUICK.map((h) => <button key={h} type="button" onClick={() => quick(h)} className="rounded border border-gray-500 px-3 py-1 text-sm">{t.hours(h)}</button>)}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold">{f.options}</legend>
        <div><label htmlFor="radiusMeters" className="block text-sm">{f.radius}</label>
          <select id="radiusMeters" name="radiusMeters" defaultValue={defaults.radiusMeters ?? "1000"} className={field}>
            {[500, 1000, 2000, 3000, 5000].map((r) => <option key={r} value={r}>{r >= 1000 ? `${r / 1000}km` : `${r}m`}</option>)}
          </select></div>
        <div><label htmlFor="type" className="block text-sm">{f.type}</label>
          <select id="type" name="type" defaultValue={defaults.type ?? "all"} className={field}>
            <option value="all">{f.all}</option><option value="off_street">{t.type.OFF_STREET}</option><option value="on_street">{t.type.ON_STREET}</option>
          </select></div>
        <div><label htmlFor="sort" className="block text-sm">{f.sort}</label>
          <select id="sort" name="sort" defaultValue={defaults.sort ?? "free_first"} className={field}>
            {(Object.keys(f.sorts) as Array<keyof typeof f.sorts>).map((k) => <option key={k} value={k}>{f.sorts[k]}</option>)}
          </select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="freeOnly" value="true" defaultChecked={defaults.freeOnly} /> {f.freeOnly}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="realtimeOnly" value="true" defaultChecked={defaults.realtimeOnly} /> {f.realtimeOnly}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="operatingOnly" value="true" defaultChecked={defaults.operatingOnly} /> {f.operatingOnly}</label>
      </fieldset>

      <button type="submit" className="w-full rounded bg-blue-700 px-4 py-3 text-base font-semibold text-white">{f.submit}</button>
    </form>
  );
}
