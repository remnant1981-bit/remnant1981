import Link from "next/link";
import { formatKst } from "@/lib/time";
import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";

/** 홈: 처음 온 이용자를 위한 계산 방식·표시 의미 안내(서버 렌더, 접혀 있음) */
export function HowItWorks({ dataCollectedAt, lang = "ko" }: { dataCollectedAt: string | null; lang?: Lang }) {
  const t = dict(lang);
  return (
    <details className="mt-8 rounded border border-gray-300 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{t.how.summary}</summary>
      <div className="mt-2 space-y-3">
        <ol className="list-decimal space-y-1 pl-5">{t.how.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
          {t.how.terms.map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold">{k}</dt><dd className="text-gray-700">{v}</dd></div>)}
        </dl>
        <p className="text-gray-700">
          {t.how.source(dataCollectedAt ? formatKst(dataCollectedAt, lang) : null)}
          {" "}<Link href="/terms" className="underline">{t.layout.terms}</Link> · <Link href="/privacy" className="underline">{t.layout.privacy}</Link>
        </p>
      </div>
    </details>
  );
}
