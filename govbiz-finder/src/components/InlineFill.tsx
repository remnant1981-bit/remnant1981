"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { SPECS, SIGUNGU } from "./profile-specs";
import { saveProfilePatch } from "./profile-save";

/**
 * 공고 카드 안에서 판정에 필요한 미입력 기업정보를 그 자리에서 입력.
 * 드롭다운은 고르는 즉시 저장·재판정, 텍스트·날짜·복수선택은 [적용] 버튼.
 */
export function InlineFill({ fields, member }: { fields: { fieldKey: string; label: string }[]; member: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const uid = useId();
  const list = fields.filter((f) => SPECS[f.fieldKey]);
  if (!list.length) return null;

  async function save(key: string, value: string) {
    if (!value) return;
    setBusy(key); setErr("");
    const e = await saveProfilePatch(member, { [key]: value });
    setBusy("");
    if (e) setErr(e); else router.refresh();
  }

  return (
    <div className="no-print mt-1 grid gap-2">
      {list.map((f) => {
        const s = SPECS[f.fieldKey];
        const id = `${uid}-${s.key}`;
        const saving = busy === s.key;
        if (s.kind === "sigungu") return (
          <div key={f.fieldKey} className="flex flex-wrap items-center gap-2">
            <label htmlFor={id} className="text-sm font-medium">✎ {f.label}</label>
            <select id={id} defaultValue="" disabled={saving} className="input !w-auto !py-1 text-sm" onChange={(e) => save(s.key, e.target.value)}>
              <option value="">선택하면 바로 판정</option>
              {Object.entries(SIGUNGU).map(([sd, list]) => <optgroup key={sd} label={sd}>{list.map((g) => <option key={sd + g} value={g}>{g}</option>)}</optgroup>)}
            </select>
            {saving && <span className="text-xs">판정 중…</span>}
          </div>);
        if (s.kind === "select") return (
          <div key={f.fieldKey} className="flex flex-wrap items-center gap-2">
            <label htmlFor={id} className="text-sm font-medium">✎ {f.label}</label>
            <select id={id} defaultValue="" disabled={saving} className="input !w-auto !py-1 text-sm" onChange={(e) => save(s.key, e.target.value)}>
              <option value="">선택하면 바로 판정</option>
              {s.opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            {saving && <span className="text-xs">판정 중…</span>}
          </div>);
        return (
          <form key={f.fieldKey} className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save(s.key, s.kind === "checks" ? fd.getAll(s.key).map(String).join(",") : String(fd.get(s.key) ?? "").trim());
          }}>
            {s.kind === "checks" ? (
              <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><legend className="mr-2 inline font-medium">✎ {f.label}</legend>
                {s.items.map((c) => <label key={c} className="inline-flex items-center gap-1"><input type="checkbox" name={s.key} value={c} /> {c}</label>)}
              </fieldset>
            ) : (
              <>
                <label htmlFor={id} className="text-sm font-medium">✎ {f.label}</label>
                <input id={id} name={s.key} type={s.kind === "date" ? "date" : "text"} maxLength={s.kind === "date" ? 10 : 100}
                  placeholder={s.kind === "text" ? s.placeholder : undefined} className="input !w-auto !py-1 text-sm" />
              </>
            )}
            <button className="btn !px-3 !py-1 text-sm" disabled={saving}>{saving ? "판정 중…" : "적용"}</button>
          </form>);
      })}
      <p className="text-xs text-amber-800">{member ? "기업정보에 저장되어 다른 공고 판정에도 반영됩니다." : "게스트 모드: 이 브라우저에만 저장되어 다른 공고 판정에도 반영됩니다."}</p>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
