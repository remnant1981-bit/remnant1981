"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveProfilePatch } from "./profile-save";
import { SPECS, SIGUNGU } from "./profile-specs";

export interface QuickItem { fieldKey: string; label: string; count: number }

/** 맞춤 정확도를 높이는 미입력 항목을 영향 큰 순서로 바로 입력받는다. */
export function QuickFill({ items, member, accuracy }: { items: QuickItem[]; member: boolean; accuracy: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const list = items.filter((x) => SPECS[x.fieldKey]).slice(0, 4);
  if (!list.length) return null;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr("");
    const f = new FormData(e.currentTarget);
    const next: Record<string, string> = {};
    for (const it of list) {
      const s = SPECS[it.fieldKey];
      const val = s.kind === "checks" ? f.getAll(s.key).map(String).join(",") : String(f.get(s.key) ?? "").trim();
      if (val) next[s.key] = val;
    }
    if (!Object.keys(next).length) { setErr("입력한 항목이 없습니다."); return; }
    setBusy(true);
    const e2 = await saveProfilePatch(member, next);
    if (e2) { setBusy(false); setErr(e2); return; }
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="no-print card mt-3 border-blue-200 bg-blue-50/60 p-4" aria-label="맞춤 정확도 높이기">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">🎯 맞춤 정확도 높이기 {accuracy !== null && <span className="ml-1 text-sm font-semibold text-blue-800">현재 {accuracy}%</span>}</h2>
        <span className="text-xs text-[var(--muted)]">아는 항목만 입력(모두 선택) · {member ? "기업정보에 저장" : "이 브라우저에만 저장"}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {list.map((it) => {
          const s = SPECS[it.fieldKey];
          const id = `qf_${s.key}`;
          const hint = <span className="text-xs font-normal text-blue-800"> · 공고 {it.count.toLocaleString()}건 판정에 필요</span>;
          if (s.kind === "checks") return (
            <fieldset key={it.fieldKey} className="sm:col-span-2"><legend className="label">{it.label}{hint}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{s.items.map((c) => <label key={c} className="inline-flex items-center gap-1"><input type="checkbox" name={s.key} value={c} /> {c}</label>)}</div>
            </fieldset>);
          return (
            <div key={it.fieldKey}>
              <label htmlFor={id} className="label">{it.label}{hint}</label>
              {s.kind === "sigungu"
                ? <select id={id} name={s.key} defaultValue="" className="input"><option value="">선택하세요</option>{Object.entries(SIGUNGU).map(([sd, list]) => <optgroup key={sd} label={sd}>{list.map((g) => <option key={sd + g} value={g}>{g}</option>)}</optgroup>)}</select>
                : s.kind === "select"
                ? <select id={id} name={s.key} defaultValue="" className="input"><option value="">선택하세요</option>{s.opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                : <input id={id} name={s.key} type={s.kind === "date" ? "date" : "text"} maxLength={s.kind === "date" ? 10 : 100} placeholder={s.kind === "text" ? s.placeholder : undefined} className="input" />}
            </div>);
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy}>{busy ? "반영 중…" : "입력하고 다시 판정"}</button>
        <Link className="text-sm underline" href={member ? "/company" : "#edit-profile"}>전체 기업정보 보기</Link>
        {err && <span role="alert" className="text-sm text-red-700">{err}</span>}
      </div>
    </form>
  );
}
