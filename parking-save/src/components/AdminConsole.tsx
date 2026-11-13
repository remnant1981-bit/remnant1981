"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AdminOverrideEditor, SyncHistoryChart } from "./AdminOverrideEditor";

// 토큰은 이 탭(sessionStorage)에만 보관하고 탭을 닫으면 사라짐
const TOKEN_KEY = "parkingsave:admin-token";
const CAT: Record<string, string> = { FEE: "요금", HOURS: "운영시간", LOCATION: "위치·주소", CLOSED: "폐쇄", OTHER: "기타" };
type Overview = {
  counts: { reports: number; duplicates: number };
  sync: Array<{ source_name: string; status: string; started_at: string; finished_at: string | null; records_received: number | null; error_summary: string | null }>;
  reports: Array<{ id: number; parking_lot_id: number; name: string; category: string; message: string | null; created_at: string }>;
  syncHistory: Array<{ source_name: string; status: string; started_at: string; records_received: number | null }>;
  overrides: Array<{ id: number; parking_lot_id: number; name: string; kind: string; note: string | null; report_id: number | null; status: string; created_by: string; created_at: string; ended_by: string | null; ended_at: string | null }>;
  duplicates: Array<{ id: number; score: number | null; reason: string | null; a: { id: number; name: string; address: string | null; totalSpaces: number | null; source: string }; b: { id: number; name: string; address: string | null; totalSpaces: number | null; source: string } }>;
};
const kst = (iso: string | null) => (iso ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "-");

function readToken(): string { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } }
const tokenListeners = new Set<() => void>();
function writeToken(t: string) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* 저장 불가 */ } tokenListeners.forEach((l) => l()); }
const subscribeToken = (l: () => void) => { tokenListeners.add(l); return () => { tokenListeners.delete(l); }; };

export function AdminConsole() {
  const token = useSyncExternalStore(subscribeToken, readToken, () => "");
  const [input, setInput] = useState("");
  const [actor, setActor] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [quality, setQuality] = useState<{ alerts: Array<{ code: string; level: string; message: string }> } | null>(null);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<{ lotId: number; reportId: number | null } | null>(null);
  const [lotInput, setLotInput] = useState("");

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message ?? `오류 ${res.status}`);
    return j;
  }, [token]);

  const load = useCallback(() => call("/api/admin/overview").then((d) => { setData(d); setMsg(""); }, (e: Error) => { setData(null); setMsg(e.message); }), [call]);

  // 토큰이 있으면(입력 직후 또는 이 탭에 저장된 경우) 현황을 불러옴
  useEffect(() => { if (token) load(); }, [token, load]);

  const act = async (path: string, body: Record<string, string>) => {
    if (!actor.trim()) { setMsg("처리자 이름을 입력하세요."); return; }
    try { await call(path, { method: "POST", body: JSON.stringify({ ...body, by: actor }) }); await load(); setMsg("처리했습니다."); }
    catch (e) { setMsg((e as Error).message); }
  };

  if (!token) {
    return (
      <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); writeToken(input.trim()); }}>
        <label htmlFor="admin-token" className="block text-sm">관리자 토큰(ADMIN_API_TOKEN)</label>
        <input id="admin-token" type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} className="w-full rounded border border-gray-400 bg-white px-3 py-2" />
        <button type="submit" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white">접속</button>
        {msg && <p role="alert" className="text-sm text-red-900">{msg}</p>}
      </form>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <div><label htmlFor="admin-actor" className="block text-sm">처리자 이름</label>
          <input id="admin-actor" value={actor} onChange={(e) => setActor(e.target.value)} className="rounded border border-gray-400 bg-white px-3 py-2" /></div>
        <button type="button" onClick={load} className="rounded border border-gray-500 px-3 py-2 text-sm">새로고침</button>
        <button type="button" onClick={() => { writeToken(""); setData(null); }} className="rounded border border-gray-500 px-3 py-2 text-sm">로그아웃</button>
      </div>
      <p role="status" aria-live="polite" className="text-sm">{msg}</p>
      {data && (
        <>
          <section aria-labelledby="sync-h">
            <h2 id="sync-h" className="font-semibold">수집 상태(원천별 마지막 실행)</h2>
            {data.sync.length === 0 ? <p className="text-sm text-gray-700">수집 이력 없음</p> : <div className="overflow-x-auto"><table className="mt-1 w-full text-sm tabular-nums"><thead><tr className="text-left text-gray-600"><th scope="col">원천</th><th scope="col">상태</th><th scope="col">종료</th><th scope="col">받은 건수</th><th scope="col">오류</th></tr></thead>
              <tbody>{data.sync.map((s) => <tr key={s.source_name}><td>{s.source_name}</td><td>{s.status}</td><td>{kst(s.finished_at)}</td><td>{s.records_received ?? "-"}</td><td>{s.error_summary ?? ""}</td></tr>)}</tbody></table></div>}
            {data.syncHistory.length > 0 && <SyncHistoryChart rows={data.syncHistory} />}
          </section>

          <section aria-labelledby="rep-h">
            <h2 id="rep-h" className="font-semibold">정보 오류 신고 (대기 {data.counts.reports}건)</h2>
            {data.reports.length === 0 ? <p className="text-sm text-gray-700">검토 대기 신고 없음</p> : (
              <ul className="mt-1 space-y-2">{data.reports.map((r) => (
                <li key={r.id} className="rounded border border-gray-300 p-2 text-sm">
                  <p><b>#{r.id}</b> [{CAT[r.category] ?? r.category}] <Link href={`/lots/${r.parking_lot_id}`} className="underline">{r.name}</Link> <span className="text-xs text-gray-600">{kst(r.created_at)}</span></p>
                  <p className="mt-1 whitespace-pre-wrap">{r.message ?? "(내용 없음)"}</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" className="rounded border border-gray-500 px-2 py-1" onClick={() => act(`/api/admin/reports/${r.id}`, { status: "REVIEWED" })}>확인(반영 예정)</button>
                    <button type="button" className="rounded border border-gray-500 px-2 py-1" onClick={() => act(`/api/admin/reports/${r.id}`, { status: "DISMISSED" })}>기각</button>
                    {(r.category === "FEE" || r.category === "HOURS") && <button type="button" className="rounded border border-blue-700 px-2 py-1" onClick={() => setEditing({ lotId: r.parking_lot_id, reportId: r.id })}>보정 입력</button>}
                  </div>
                  {editing?.reportId === r.id && <AdminOverrideEditor lotId={r.parking_lot_id} reportId={r.id} actor={actor} call={call} onCancel={() => setEditing(null)} onDone={async (m) => { setEditing(null); await load(); setMsg(m); }} />}
                </li>))}</ul>)}
          </section>

          <section aria-labelledby="ov-h">
            <h2 id="ov-h" className="font-semibold">수동 보정(요금·운영시간)</h2>
            <form className="mt-1 flex flex-wrap items-end gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); if (/^\d{1,9}$/.test(lotInput.trim())) setEditing({ lotId: Number(lotInput.trim()), reportId: null }); else setMsg("시설 번호(상세 주소 /lots/ 뒤의 숫자)를 입력하세요."); }}>
              <div><label htmlFor="ov-lot" className="block">시설 번호</label><input id="ov-lot" inputMode="numeric" value={lotInput} onChange={(e) => setLotInput(e.target.value)} className="w-28 rounded border border-gray-400 bg-white px-2 py-1" /></div>
              <button type="submit" className="rounded border border-gray-500 px-3 py-1">보정 입력 열기</button>
            </form>
            {editing && editing.reportId == null && <AdminOverrideEditor key={editing.lotId} lotId={editing.lotId} reportId={null} actor={actor} call={call} onCancel={() => setEditing(null)} onDone={async (m) => { setEditing(null); await load(); setMsg(m); }} />}
            {data.overrides.length === 0 ? <p className="mt-1 text-sm text-gray-700">보정 이력 없음</p> : (
              <ul className="mt-2 space-y-1 text-sm">{data.overrides.map((o) => (
                <li key={o.id} className="rounded border border-gray-300 p-2">
                  <b>#{o.id}</b> [{o.kind === "FEE" ? "요금" : "운영시간"}] <Link href={`/lots/${o.parking_lot_id}`} className="underline">{o.name}</Link> · {o.status === "ACTIVE" ? "적용 중" : o.status === "REVERTED" ? "되돌림" : "대체됨"} · {o.created_by} {kst(o.created_at)}{o.report_id ? ` · 신고 #${o.report_id}` : ""}
                  <span className="block text-xs text-gray-700">{o.note ?? ""}{o.ended_by ? ` (종료: ${o.ended_by} ${kst(o.ended_at)})` : ""}</span>
                  {o.status === "ACTIVE" && <button type="button" className="mt-1 rounded border border-gray-500 px-2 py-1" onClick={() => act(`/api/admin/overrides/${o.id}/revert`, {})}>되돌리기(원천 값 복원)</button>}
                </li>))}</ul>)}
          </section>

          <section aria-labelledby="dup-h">
            <h2 id="dup-h" className="font-semibold">중복·연결 후보 (대기 {data.counts.duplicates}건)</h2>
            <p className="text-xs text-gray-600">승인해도 레코드를 합치지 않고 &lsquo;동일 시설&rsquo; 연결만 기록합니다(검색 결과 묶음·실시간 연결에 사용).</p>
            {data.duplicates.length === 0 ? <p className="text-sm text-gray-700">검토 대기 후보 없음</p> : (
              <ul className="mt-1 space-y-2">{data.duplicates.map((c) => (
                <li key={c.id} className="rounded border border-gray-300 p-2 text-sm">
                  <p><b>#{c.id}</b> 점수 {c.score ?? "-"} · {c.reason}</p>
                  {[c.a, c.b].map((x) => <p key={x.id} className="text-xs"><Link href={`/lots/${x.id}`} className="underline">{x.name}</Link> · {x.address ?? "-"} · {x.totalSpaces ?? "-"}면 · {x.source}</p>)}
                  <div className="mt-1 flex gap-2">
                    <button type="button" className="rounded border border-gray-500 px-2 py-1" onClick={() => act(`/api/admin/duplicates/${c.id}`, { decision: "MERGED" })}>동일 시설로 승인</button>
                    <button type="button" className="rounded border border-gray-500 px-2 py-1" onClick={() => act(`/api/admin/duplicates/${c.id}`, { decision: "REJECTED" })}>다른 시설(거절)</button>
                  </div>
                </li>))}</ul>)}
          </section>

          <section aria-labelledby="q-h">
            <h2 id="q-h" className="font-semibold">데이터 품질 리포트</h2>
            <button type="button" className="mt-1 rounded border border-gray-500 px-3 py-1.5 text-sm" onClick={async () => { try { setQuality(await call("/api/admin/quality")); } catch (e) { setMsg((e as Error).message); } }}>리포트 불러오기</button>
            {quality && <ul className="mt-2 space-y-1 text-sm">{quality.alerts.length === 0 ? <li>알림 없음</li> : quality.alerts.map((a, i) => <li key={i}><b>[{a.level}]</b> {a.message}</li>)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
