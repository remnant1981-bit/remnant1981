import Link from "next/link";
import type { LotItem } from "@/server/search";
import { OPERATING_LABEL, OWNERSHIP_LABEL, TYPE_LABEL, distLabel, feeText, occupancyText, sourceLabel } from "@/lib/labels";
import { formatKst } from "@/lib/time";

export function LotCard({ item, query }: { item: LotItem; query: string }) {
  const fee = feeText(item.fee);
  const occ = occupancyText(item.occupancy);
  const tone = fee.tone === "free" ? "text-green-800" : fee.tone === "paid" ? "text-gray-900" : "text-gray-600";
  return (
    <li className="rounded-lg border border-gray-300 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold"><Link href={`/lots/${item.id}?${query}`} className="underline">{item.name}</Link></h2>
        <span className="text-sm text-gray-700">{distLabel(item.distanceMeters)} <span className="text-xs">(직선거리)</span></span>
      </div>
      <p className="mt-1 text-sm text-gray-700">{item.address ?? "주소 정보 없음"}</p>
      <p className="mt-1 text-xs text-gray-700">{TYPE_LABEL[item.parkingType]} · {OWNERSHIP_LABEL[item.ownershipType]}{item.isMock ? " · 목업" : ""}</p>
      {(item.explanation.highlights.length > 0 || item.explanation.cautions.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="이 시설의 특징과 유의점">
          {item.explanation.highlights.map((t) => <li key={t} className="rounded bg-green-50 px-2 py-1 text-green-900"><span className="sr-only">장점: </span>{t}</li>)}
          {item.explanation.cautions.map((t) => <li key={t} className="rounded bg-amber-50 px-2 py-1 text-amber-900"><span className="sr-only">유의: </span>{t}</li>)}
        </ul>
      )}
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-gray-600">예상 주차요금</dt>
          <dd className={`text-base font-bold ${tone}`}>{fee.main}{fee.sub && <span className="block text-xs font-normal text-gray-600">{fee.sub}</span>}</dd></div>
        <div><dt className="text-gray-600">운영 상태</dt><dd>{OPERATING_LABEL[item.operating]}</dd></div>
        <div><dt className="text-gray-600">전체 주차면수</dt><dd>{item.totalSpaces != null ? `${item.totalSpaces}면` : "정보 없음"}</dd></div>
        <div><dt className="text-gray-600">실시간 잔여면수</dt><dd>{occ.main}{occ.sub && <span className="block text-xs text-gray-600">{occ.sub}</span>}</dd></div>
      </dl>
      {item.similar.length > 0 && (
        <details className="mt-3 text-xs text-gray-700">
          <summary className="cursor-pointer underline">같은 시설일 가능성이 있는 다른 기록 {item.similar.length}건</summary>
          <ul className="mt-1 list-disc pl-5">
            {item.similar.map((s) => (
              <li key={s.id}><Link href={`/lots/${s.id}?${query}`} className="underline">{s.name}</Link> · {distLabel(s.distanceMeters)} · {s.status === "MERGED" ? "동일 시설로 승인됨" : "동일 시설 후보(미확정)"}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-xs text-gray-600">
        출처: {sourceLabel(item.source.name)} · 기준일 {formatKst(item.source.updatedAt ?? item.source.collectedAt)}
        {item.source.freshness === "STALE" && <strong className="ml-1 text-amber-800">· 오래된 데이터</strong>}
      </p>
    </li>
  );
}
