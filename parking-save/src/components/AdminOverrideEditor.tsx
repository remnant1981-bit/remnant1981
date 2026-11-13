"use client";
import { useEffect, useState } from "react";

type Call = (path: string, init?: RequestInit) => Promise<any>;
type LotData = {
  lot: { id: number; name: string; road_address: string | null; address: string | null; fee_note: string | null; source_updated_at: string | null };
  feeRules: Array<{ rule_type: string; amount: number | null; duration_minutes: number | null; valid_day_type: string }>;
  schedules: Array<{ day_type: string; open_time: string | null; close_time: string | null; all_day_flag: number | null; closed_flag: number | null }>;
  history: Array<{ id: number; kind: string; status: string; note: string | null; created_by: string; created_at: string; ended_by: string | null }>;
};
const DAY: Record<string, string> = { WEEKDAY: "평일", SATURDAY: "토요일", SUNDAY: "일요일", HOLIDAY: "공휴일", EVERYDAY: "매일" };
const RULE: Record<string, string> = { BASE: "기본", ADDITIONAL: "추가", DAILY_MAX: "일 최대", FREE: "무료", SEASON_PASS: "정기권" };
const field = "w-24 rounded border border-gray-400 bg-white px-2 py-1";
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** 시설 요금·운영시간 수동 보정 입력. 확인한 값만 입력(추정 입력 금지) */
export function AdminOverrideEditor({ lotId, reportId, actor, call, onDone, onCancel }: { lotId: number; reportId: number | null; actor: string; call: Call; onDone: (msg: string) => void | Promise<void>; onCancel: () => void }) {
  const [data, setData] = useState<LotData | null>(null);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState<"FEE" | "HOURS">("FEE");
  const [free, setFree] = useState(false);
  const [fee, setFee] = useState({ baseMinutes: "", baseAmount: "", addMinutes: "", addAmount: "", dailyMax: "" });
  const [everyday, setEveryday] = useState(true);
  const [hours, setHours] = useState<Record<string, { mode: "HOURS" | "ALL_DAY" | "CLOSED" | "SKIP"; open: string; close: string }>>(
    Object.fromEntries(["EVERYDAY", "WEEKDAY", "SATURDAY", "SUNDAY", "HOLIDAY"].map((d) => [d, { mode: d === "EVERYDAY" ? "HOURS" : "SKIP", open: "09:00", close: "18:00" }])) as never);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    call(`/api/admin/lots/${lotId}`).then((d) => { if (alive) { setData(d); setErr(""); } }, (e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [lotId, call]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor.trim()) { setErr("위의 처리자 이름을 먼저 입력하세요."); return; }
    if (!note.trim()) { setErr("확인 근거(현장 요금표·공고 등)를 적어 주세요."); return; }
    const payload = kind === "FEE"
      ? (free ? { free: true } : { free: false, baseMinutes: numOrNull(fee.baseMinutes), baseAmount: numOrNull(fee.baseAmount), addMinutes: numOrNull(fee.addMinutes), addAmount: numOrNull(fee.addAmount), dailyMax: numOrNull(fee.dailyMax) })
      : { rows: (everyday ? ["EVERYDAY"] : ["WEEKDAY", "SATURDAY", "SUNDAY", "HOLIDAY"]).filter((d) => hours[d].mode !== "SKIP").map((d) => ({ dayType: d, mode: hours[d].mode, open: hours[d].open, close: hours[d].close })) };
    setBusy(true);
    try {
      await call(`/api/admin/lots/${lotId}/overrides`, { method: "POST", body: JSON.stringify({ kind, payload, note, reportId, by: actor }) });
      onDone(`보정을 적용했습니다(시설 ${lotId}).`);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  const setH = (d: string, v: Partial<{ mode: "HOURS" | "ALL_DAY" | "CLOSED" | "SKIP"; open: string; close: string }>) => setHours((h) => ({ ...h, [d]: { ...h[d], ...v } }));

  return (
    <div className="mt-2 rounded border border-blue-300 bg-blue-50 p-3 text-sm" role="group" aria-label={`시설 ${lotId} 보정`}>
      {!data ? <p role="status">{err || "불러오는 중…"}</p> : (
        <form onSubmit={submit} className="space-y-3">
          <p className="font-semibold">{data.lot.name} <span className="font-normal text-gray-700">· {data.lot.road_address ?? data.lot.address ?? "주소 없음"} · 원천 기준일 {data.lot.source_updated_at?.slice(0, 10) ?? "미확인"}</span></p>
          <p className="text-xs text-gray-700">현재 요금: {data.feeRules.length ? data.feeRules.map((r) => `${RULE[r.rule_type] ?? r.rule_type}${r.duration_minutes ? ` ${r.duration_minutes}분` : ""}${r.amount != null ? ` ${r.amount.toLocaleString("ko-KR")}원` : ""}(${DAY[r.valid_day_type] ?? r.valid_day_type})`).join(" · ") : "규칙 없음"}</p>
          <p className="text-xs text-gray-700">현재 운영시간: {data.schedules.length ? data.schedules.map((s) => `${DAY[s.day_type] ?? s.day_type} ${s.closed_flag ? "휴무" : s.all_day_flag ? "24시간" : `${s.open_time}~${s.close_time}`}`).join(" · ") : "정보 없음"}</p>
          {data.lot.fee_note && <p className="text-xs text-gray-700">원천 특기사항: “{data.lot.fee_note}”</p>}
          <fieldset><legend className="font-semibold">무엇을 보정하나요?</legend>
            <label className="mr-4"><input type="radio" name="ov-kind" checked={kind === "FEE"} onChange={() => setKind("FEE")} /> 요금</label>
            <label><input type="radio" name="ov-kind" checked={kind === "HOURS"} onChange={() => setKind("HOURS")} /> 운영시간</label>
          </fieldset>
          {kind === "FEE" ? (
            <fieldset className="space-y-2"><legend className="sr-only">요금 보정 값</legend>
              <label className="block"><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> 항상 무료</label>
              {!free && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label>기본시간(분) <input className={field} inputMode="numeric" value={fee.baseMinutes} onChange={(e) => setFee({ ...fee, baseMinutes: e.target.value })} /></label>
                  <label>기본요금(원) <input className={field} inputMode="numeric" value={fee.baseAmount} onChange={(e) => setFee({ ...fee, baseAmount: e.target.value })} /></label>
                  <label>추가 단위시간(분) <input className={field} inputMode="numeric" value={fee.addMinutes} onChange={(e) => setFee({ ...fee, addMinutes: e.target.value })} /></label>
                  <label>추가요금(원) <input className={field} inputMode="numeric" value={fee.addAmount} onChange={(e) => setFee({ ...fee, addAmount: e.target.value })} /></label>
                  <label>일 최대요금(원, 하루 기준·없으면 비움) <input className={field} inputMode="numeric" value={fee.dailyMax} onChange={(e) => setFee({ ...fee, dailyMax: e.target.value })} /></label>
                </div>
              )}
              <p className="text-xs text-gray-700">요일·시간대별로 요금이 다른 시설은 이 화면으로 보정할 수 없습니다(매일 같은 요금만).</p>
            </fieldset>
          ) : (
            <fieldset className="space-y-2"><legend className="sr-only">운영시간 보정 값</legend>
              <label className="block"><input type="checkbox" checked={everyday} onChange={(e) => setEveryday(e.target.checked)} /> 매일 같음</label>
              {(everyday ? ["EVERYDAY"] : ["WEEKDAY", "SATURDAY", "SUNDAY", "HOLIDAY"]).map((d) => (
                <div key={d} className="flex flex-wrap items-center gap-2">
                  <span className="w-14">{DAY[d]}</span>
                  <select aria-label={`${DAY[d]} 운영 방식`} className="rounded border border-gray-400 bg-white px-2 py-1" value={hours[d].mode} onChange={(e) => setH(d, { mode: e.target.value as never })}>
                    <option value="HOURS">시간 지정</option><option value="ALL_DAY">24시간</option><option value="CLOSED">휴무</option>{d !== "EVERYDAY" && <option value="SKIP">입력 안 함(확인 불가)</option>}
                  </select>
                  {hours[d].mode === "HOURS" && <>
                    <input aria-label={`${DAY[d]} 여는 시각`} type="time" className="rounded border border-gray-400 bg-white px-2 py-1" value={hours[d].open} onChange={(e) => setH(d, { open: e.target.value })} />
                    ~ <input aria-label={`${DAY[d]} 닫는 시각`} type="time" className="rounded border border-gray-400 bg-white px-2 py-1" value={hours[d].close} onChange={(e) => setH(d, { close: e.target.value })} />
                  </>}
                </div>
              ))}
            </fieldset>
          )}
          <label className="block">확인 근거(필수, 예: 2026-11-13 현장 요금표 사진·구청 공고)
            <input className="mt-1 w-full rounded border border-gray-400 bg-white px-2 py-1" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="text-xs text-gray-700">직접 확인한 값만 입력하세요. 보정 값은 원천 수집보다 우선해 표시되고, 원천 값은 보존되어 언제든 되돌릴 수 있습니다.{reportId != null && ` 적용하면 신고 #${reportId}는 '확인'으로 처리됩니다.`}</p>
          {err && <p role="alert" className="text-red-900">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded bg-blue-700 px-3 py-1.5 font-semibold text-white">{busy ? "적용 중…" : "보정 적용"}</button>
            <button type="button" onClick={onCancel} className="rounded border border-gray-500 px-3 py-1.5">닫기</button>
          </div>
          {data.history.length > 0 && (
            <details><summary className="cursor-pointer underline">이 시설 보정 이력 {data.history.length}건</summary>
              <ul className="mt-1 list-disc pl-5 text-xs">{data.history.map((h) => <li key={h.id}>#{h.id} {h.kind === "FEE" ? "요금" : "운영시간"} · {h.status === "ACTIVE" ? "적용 중" : h.status === "REVERTED" ? "되돌림" : "대체됨"} · {h.created_by} {h.created_at.slice(0, 10)}{h.ended_by ? ` → ${h.ended_by}` : ""} · {h.note ?? ""}</li>)}</ul>
            </details>
          )}
        </form>
      )}
    </div>
  );
}

/** 수집 이력(원천별 최근 14회 받은 건수) 막대 그래프. 실패한 실행은 빗금 대신 '실패' 글자와 빈 막대로 표시 */
export function SyncHistoryChart({ rows }: { rows: Array<{ source_name: string; status: string; started_at: string; records_received: number | null }> }) {
  const by = new Map<string, typeof rows>();
  for (const r of rows) (by.get(r.source_name) ?? by.set(r.source_name, []).get(r.source_name)!).push(r);
  const W = 320, H = 70, PAD = 4;
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      {[...by].map(([src, list]) => {
        const max = Math.max(1, ...list.map((r) => r.records_received ?? 0));
        const slot = (W - PAD * 2) / 14, bw = slot - 3;
        const last = list[list.length - 1];
        return (
          <figure key={src} className="text-xs">
            <figcaption className="text-gray-700">{src} — 최근 {list.length}회 받은 건수(최대 {max.toLocaleString("ko-KR")})</figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm" role="img" aria-label={`${src} 최근 ${list.length}회 수집. 마지막 ${last.status} ${last.records_received ?? 0}건`}>
              <line x1={PAD} x2={W - PAD} y1={H - 12} y2={H - 12} style={{ stroke: "var(--chart-grid)" }} />
              {list.map((r, i) => {
                const h = Math.max(2, ((r.records_received ?? 0) / max) * (H - 24));
                const x = PAD + slot * i, failed = r.status === "FAILED";
                return (
                  <g key={r.started_at}>
                    <title>{`${r.started_at.slice(0, 16).replace("T", " ")} UTC · ${r.status} · ${r.records_received ?? 0}건`}</title>
                    <rect x={x} y={H - 12 - h} width={bw} height={h} rx={2} style={failed ? { fill: "none", stroke: "var(--chart-muted)", strokeDasharray: "3 2" } : { fill: "var(--chart-bar)", opacity: r.status === "PARTIAL" ? 0.55 : 1 }} />
                    {failed && <text x={x + bw / 2} y={H - 2} textAnchor="middle" fontSize={8} style={{ fill: "var(--chart-ink)" }}>실패</text>}
                  </g>
                );
              })}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
