import type { Lang } from "@/i18n";
import { dict } from "@/i18n/dict";

export function MockBanner({ lang = "ko" }: { lang?: Lang }) {
  const t = dict(lang).misc;
  return (
    <p role="note" className="border-b border-amber-400 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      <strong>{t.mockTitle}</strong>{t.mockBody}
    </p>
  );
}
