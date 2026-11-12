import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";

export function TooManyRequests({ retryAfterSec, lang = "ko" }: { retryAfterSec: number; lang?: Lang }) {
  const t = dict(lang).misc;
  return (
    <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-4">
      <p className="font-semibold">{t.tooMany}</p>
      <p className="mt-1 text-sm">{t.retry(retryAfterSec)}</p>
    </div>
  );
}
