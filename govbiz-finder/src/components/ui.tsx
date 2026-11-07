import Link from "next/link";
import { STATUS_LABEL, categoryName } from "@/domain/taxonomy";
import { OVERALL_LABEL, STATE_LABEL, type MatchResult, type RuleState } from "@/domain/matching";
import { formatSeoul } from "@/lib/time";

export function StatusChip({ status, basis }: { status: string; basis?: string }) {
  return (
    <span className={`chip chip-${status}`}>
      {STATUS_LABEL[status] ?? "상태 확인 필요"}
      {basis === "estimated" && status !== "unknown" && status !== "always" ? " (추정)" : ""}
    </span>
  );
}

export function FitChip({ match }: { match: MatchResult }) {
  const cls = match.overall === "likely_met" ? "chip-met" : match.overall === "likely_not_met" ? "chip-notmet" : "chip-check";
  return <span className={`chip ${cls}`}>{OVERALL_LABEL[match.overall]}</span>;
}
export function RuleChip({ state }: { state: RuleState }) {
  const cls = state === "MET" ? "chip-met" : state === "NOT_MET" ? "chip-notmet" : "chip-check";
  return <span className={`chip ${cls}`}>{STATE_LABEL[state]}</span>;
}

export function TestBadge({ status, name }: { status: string; name: string }) {
  if (status !== "mock") return null;
  return <span className="chip chip-test" title={name}>테스트 데이터</span>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "error" }) {
  const c = tone === "error" ? "bg-red-50 border-red-300 text-red-900" : tone === "warn" ? "bg-amber-50 border-amber-300 text-amber-900" : "bg-blue-50 border-blue-200 text-blue-900";
  return <div role={tone === "error" ? "alert" : "note"} className={`rounded-lg border px-4 py-3 text-sm ${c}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-[var(--muted)]">{children}</div>}
    </div>
  );
}

export function CategoryTags({ ids }: { ids: string | null }) {
  if (!ids) return null;
  return <>{ids.split(",").map((id) => <span key={id} className="chip bg-[var(--brand-soft)] text-[var(--brand)]">{categoryName(id)}</span>)}</>;
}

export function Provenance({ url, sourceName, sourceStatus, checkedAt }: { url: string; sourceName: string; sourceStatus: string; checkedAt: string }) {
  return (
    <p className="text-xs text-[var(--muted)]">
      출처: {sourceStatus === "mock" ? "테스트(모의) 데이터" : sourceName} · 최종 확인 {formatSeoul(checkedAt)} ·{" "}
      <a className="underline" href={url} target="_blank" rel="noopener noreferrer nofollow">공식 원문 열기</a>
    </p>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-sm text-[var(--brand)] underline">{children}</Link>;
}
