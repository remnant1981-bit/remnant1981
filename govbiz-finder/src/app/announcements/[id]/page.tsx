import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { getAnnouncement, getAnnouncementExtras } from "@/domain/search";
import { getViewer } from "@/server/viewer";
import { loadRules } from "@/server/recommend";
import { bookmarkedIds, recordView } from "@/server/userdata";
import { evaluateMatch, OVERALL_LABEL } from "@/domain/matching";
import { categoryName } from "@/domain/taxonomy";
import { CategoryTags, FitChip, Notice, Provenance, RuleChip, StatusChip, TestBadge, BackLink } from "@/components/ui";
import { BookmarkButton } from "@/components/BookmarkButton";
import { PrintButton } from "@/components/PrintButton";
import { seoulToday, formatSeoul } from "@/lib/time";
import { FormattedText } from "@/components/FormattedText";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const a = await getAnnouncement(await getDb(), id);
  if (!a) return { title: "공고를 찾을 수 없음", robots: { index: false } };
  const isTest = a.source_status === "mock";
  return {
    title: a.title,
    description: `${a.organization} · ${a.target_summary ?? ""} ${a.support_summary ?? ""}`.slice(0, 150),
    alternates: { canonical: `/announcements/${a.id}` },
    robots: isTest ? { index: false, follow: false } : { index: true, follow: true }, // 테스트 데이터는 색인 제외
  };
}

const t = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function Section({ title, children, text }: { title: string; children?: React.ReactNode; text?: string | null }) {
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-bold">{title}</h2>
      {children ?? <FormattedText text={text} />}
    </section>
  );
}

export default async function Detail({ params }: Props) {
  const { id } = await params;
  const db = await getDb();
  const a = await getAnnouncement(db, id);
  if (!a) notFound();
  const [extras, v] = await Promise.all([getAnnouncementExtras(db, a.id), getViewer()]);
  let match = null;
  let bookmarked = false;
  if (v.company && v.session) {
    const rules = await loadRules(db, [a.id]);
    match = evaluateMatch(rules.get(a.id) ?? [], v.company, seoulToday());
    await recordView(db, v.session.user.id, v.company.id, a.id);
    bookmarked = (await bookmarkedIds(db, v.session.user.id, v.company.id)).has(a.id);
  }
  const money = a.support_amount_text || (a.support_amount_max ? `최대 ${Number(a.support_amount_max).toLocaleString()}원` : null);
  return (
    <article className="grid gap-4">
      <BackLink href="/search">← 검색 결과로</BackLink>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={a.application_status} basis={a.status_basis} />
          <CategoryTags ids={a.category_ids} />
          <TestBadge status={a.source_status} name={a.source_name} />
          {match && <FitChip match={match} />}
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-snug">{a.title}</h1>
        <p className="text-sm text-[var(--muted)]">{a.organization} · {a.region_scope}</p>
        <div className="no-print mt-3 flex flex-wrap items-center gap-2">
          <a className="btn" href={a.canonical_url} target="_blank" rel="noopener noreferrer nofollow">공식 원문 바로가기</a>
          <PrintButton />
          {v.company && <BookmarkButton announcementId={a.id} initial={bookmarked} />}
        </div>
        <div className="mt-3"><Provenance url={a.canonical_url} sourceName={a.source_name} sourceStatus={a.source_status} checkedAt={a.last_checked_at} /></div>
      </header>

      {a.source_status === "mock" && <Notice tone="warn">이 공고는 개발용 <strong>테스트(모의) 데이터</strong>이며 실제 공고가 아닙니다.</Notice>}
      {a.status_basis === "estimated" && a.application_status !== "unknown" && <Notice>접수 상태는 접수 기간 날짜로 <strong>추정</strong>한 값입니다. 정확한 상태는 공식 원문에서 확인하세요.</Notice>}

      <Section title="사업 개요" text={t(a.original_text) || t(a.support_summary)} />
      <Section title="지원 대상·신청 자격" text={[t(a.target_summary), t(a.eligibility_text)].filter(Boolean).join("\n")} />
      <Section title="지원 내용·한도" text={[money, a.support_summary && !a.original_text ? t(a.support_summary) : ""].filter(Boolean).join("\n")} />
      <Section title="신청 기간 및 상태">
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-[var(--muted)]">접수 시작 </dt><dd className="inline font-medium">{a.application_start ?? "확인 필요"}</dd></div>
          <div><dt className="inline text-[var(--muted)]">접수 마감 </dt><dd className="inline font-medium">{a.application_end ?? (a.application_status === "always" ? "상시 접수" : "확인 필요")}</dd></div>
        </dl>
      </Section>
      <Section title="제출 서류" text={t(a.required_documents)} />
      <Section title="신청 방법" text={t(a.application_method)} />
      <Section title="문의처" text={t(a.contact_info)} />

      <section className="card p-4">
        <h2 className="mb-2 font-bold">첨부파일</h2>
        {extras.files.length === 0 ? <p className="text-sm text-[var(--muted)]">수집된 첨부파일이 없습니다. 공식 원문에서 확인하세요.</p> : (
          <ul className="list-disc pl-5 text-sm">{extras.files.map((f) => <li key={f.source_url}><a className="underline" href={f.source_url} target="_blank" rel="noopener noreferrer nofollow">{f.name}</a></li>)}</ul>
        )}
      </section>

      <section className="card p-4" aria-labelledby="fit">
        <h2 id="fit" className="mb-2 font-bold">기업 적합성 분석 (참고용)</h2>
        {!v.session ? (
          <p className="text-sm">로그인하고 기업 관계 확인을 완료하면 이 공고의 적합성 분석을 볼 수 있습니다. <Link href="/recommend" className="underline">기업정보 없이 체험해 보기</Link></p>
        ) : !match ? (
          <p className="text-sm">기업 관계 확인이 완료되면 분석이 표시됩니다. <Link href="/company" className="underline">기업정보 설정</Link></p>
        ) : (
          <>
            <p className="mb-2 text-sm">종합: <strong>{OVERALL_LABEL[match.overall]}</strong>{match.score !== null && ` · 참고 점수 ${match.score}점`} <span className="text-[var(--muted)]">(자격 확정 판정이 아닙니다)</span></p>
            {match.results.length === 0 ? <p className="text-sm text-[var(--muted)]">자동 판정 가능한 조건이 구조화되지 않았습니다. 원문을 확인하세요.</p> : (
              <ul className="grid gap-2">{match.results.map((r, i) => (
                <li key={i} className="rounded-lg border border-[var(--line)] p-3 text-sm">
                  <div className="flex items-center gap-2"><RuleChip state={r.state} /><strong>{r.label}</strong></div>
                  <p className="mt-1">{r.reason}</p>
                  {r.excerpt && <blockquote className="mt-1 border-l-4 border-[var(--line)] pl-3 text-[var(--muted)]">근거 문장: “{r.excerpt}”</blockquote>}
                </li>))}</ul>
            )}
          </>
        )}
      </section>

      {extras.sources.length > 1 && (
        <section className="card p-4 text-sm"><h2 className="mb-2 font-bold">동일 공고를 확인한 출처</h2>
          <ul className="list-disc pl-5">{extras.sources.map((s) => <li key={s.source_id + s.url}>{s.name} · <a className="underline" href={s.url} target="_blank" rel="noopener noreferrer nofollow">원문</a> · 최초 확인 {formatSeoul(s.first_seen_at)}</li>)}</ul></section>
      )}
      <p className="text-xs text-[var(--muted)]">분야: {a.category_ids?.split(",").map(categoryName).join(", ")} · 최초 수집 {formatSeoul(a.first_collected_at)}</p>
    </article>
  );
}
