import Link from "next/link";
import type { LotItem } from "@/server/search";
import { labelsFor } from "@/lib/labels";
import { formatKst } from "@/lib/time";
import type { Lang } from "@/i18n";
import { walkMinutesEstimate } from "@/domain/geo";
import { FavoriteButton } from "./FavoriteButton";
import { CompareToggle } from "./CompareControls";

export function LotCard({ item, query, lang = "ko" }: { item: LotItem; query: string; lang?: Lang }) {
  const { t, feeText, occupancyText, sourceLabel, discountLabel } = labelsFor(lang);
  const c = t.card;
  const fee = feeText(item.fee);
  const occ = occupancyText(item.occupancy);
  const tone = fee.tone === "free" ? "text-green-800" : fee.tone === "paid" ? "text-gray-900" : "text-gray-600";
  return (
    <li className="rounded-lg border border-gray-300 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold"><Link href={`/lots/${item.id}?${query}`} className="underline" lang="ko">{item.name}</Link></h2>
        <span className="flex items-center gap-2"><span className="text-sm text-gray-700">{t.dist(item.distanceMeters)} <span className="text-xs">{c.straight} · {t.search.walk(walkMinutesEstimate(item.distanceMeters))}</span></span>
          <FavoriteButton lang={lang} id={item.id} name={item.name} address={item.address} /><CompareToggle lang={lang} id={item.id} name={item.name} /></span>
      </div>
      <p className="mt-1 text-sm text-gray-700" lang={item.address ? "ko" : undefined}>{item.address ?? c.noAddress}</p>
      <p className="mt-1 text-xs text-gray-700">{t.type[item.parkingType]} · {t.ownership[item.ownershipType]}{item.isMock ? c.mock : ""}</p>
      {(item.explanation.highlights.length > 0 || item.explanation.cautions.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label={c.pillsAria}>
          {item.explanation.highlights.map((x) => <li key={x} className="rounded bg-green-50 px-2 py-1 text-green-900"><span className="sr-only">{c.pro}</span>{x}</li>)}
          {item.explanation.cautions.map((x) => <li key={x} className="rounded bg-amber-50 px-2 py-1 text-amber-900"><span className="sr-only">{c.con}</span>{x}</li>)}
        </ul>
      )}
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-gray-600">{c.fee}</dt>
          <dd className={`text-base font-bold ${tone}`}>{fee.main}{fee.sub && <span className="block text-xs font-normal text-gray-600">{fee.sub}</span>}</dd></div>
        <div><dt className="text-gray-600">{c.operating}</dt><dd>{t.operating[item.operating]}</dd></div>
        <div><dt className="text-gray-600">{c.total}</dt><dd>{item.totalSpaces != null ? t.spaces(item.totalSpaces) : c.noInfo}</dd></div>
        <div><dt className="text-gray-600">{c.live}</dt><dd>{occ.main}{occ.sub && <span className="block text-xs text-gray-600">{occ.sub}</span>}</dd></div>
      </dl>
      {item.similar.length > 0 && (
        <details className="mt-3 text-xs text-gray-700">
          <summary className="cursor-pointer underline">{c.similar(item.similar.length)}</summary>
          <ul className="mt-1 list-disc pl-5">
            {item.similar.map((s) => (
              <li key={s.id}><Link href={`/lots/${s.id}?${query}`} className="underline" lang="ko">{s.name}</Link> · {t.dist(s.distanceMeters)} · {s.status === "MERGED" ? c.merged : c.pending}</li>
            ))}
          </ul>
        </details>
      )}
      {item.passHint && (
        <p className="mt-2 rounded bg-blue-50 px-2 py-1 text-xs text-gray-800">
          {c.pass(item.passHint.pass, item.passHint.kind === "CHEAPER")} <span className="text-gray-600">{c.passNote}</span>
        </p>
      )}
      {item.discounts.length > 0 && (
        <p className="mt-2 text-xs text-gray-700"><span className="font-semibold">{c.discount}</span> {item.discounts.map(discountLabel).join(lang === "ko" ? "·" : ", ")} <span className="text-gray-600">{c.discountNote}</span></p>
      )}
      {item.fee.status !== "OK" && item.qualityFlags.includes("FEE_MIXED") && (
        <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {c.mixed}{item.feeNote && <> {c.sourceNote} “<span lang="ko">{item.feeNote}</span>”</>} {c.checkSite}
        </p>
      )}
      <p className="mt-3 text-xs text-gray-600">
        {c.source} {sourceLabel(item.source.name)} · {c.asOf} {formatKst(item.source.updatedAt ?? item.source.collectedAt, lang)}
        {item.source.freshness === "STALE" && <strong className="ml-1 text-amber-800">{c.stale}</strong>}
        {item.source.notInLatestSync && <strong className="ml-1 text-amber-800">{c.notInSync}</strong>}
      </p>
    </li>
  );
}
