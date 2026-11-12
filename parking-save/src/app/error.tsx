"use client";
import { useSyncExternalStore } from "react";
import { parseLang } from "@/i18n";
import { dict } from "@/i18n/dict";

const noop = () => () => {};
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  // 루트 레이아웃이 <html lang>에 화면 언어를 넣어 둠
  const lang = useSyncExternalStore(noop, () => parseLang(document.documentElement.lang), () => "ko" as const);
  const t = dict(lang).misc;
  return (
    <div role="alert" className="rounded border border-red-400 bg-red-50 p-4">
      <p className="font-semibold">{t.error}</p>
      <button type="button" onClick={reset} className="mt-2 rounded border border-gray-500 px-3 py-2 text-sm">{t.tryAgain}</button>
    </div>
  );
}
