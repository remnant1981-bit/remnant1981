import { newId, sha256Hex } from "@/lib/crypto";
import { isValidYmd, nowIso, seoulToday } from "@/lib/time";
import { CATEGORY_IDS } from "./taxonomy";
import { computeStatus, type AppStatus } from "./status";
import type { Db, SqlValue } from "@/server/db";

export interface RuleInput {
  fieldKey: string;
  operator: string;
  expectedValue: unknown;
  sourceExcerpt?: string;
  confidence?: number;
}
export interface RawAnnouncement {
  sourceNoticeId: string;
  noticeNumber?: string;
  url: string;
  title: string;
  organization: string;
  categories?: string[];
  regionScope?: string;
  targetSummary?: string;
  supportSummary?: string;
  supportAmountMin?: number | null;
  supportAmountMax?: number | null;
  supportAmountText?: string;
  applicationStart?: string | null;
  applicationEnd?: string | null;
  confirmedStatus?: AppStatus | null;
  eligibilityText?: string;
  requiredDocuments?: string;
  applicationMethod?: string;
  contactInfo?: string;
  originalText?: string;
  publishedAt?: string | null;
  files?: { name: string; url: string; mimeType?: string; sizeBytes?: number }[];
  rules?: RuleInput[];
}
export interface Normalized extends Omit<RawAnnouncement, "categories" | "regionScope"> {
  canonicalUrl: string;
  categories: string[];
  regionScope: string;
  normalizedTitle: string;
  contentHash: string;
  status: AppStatus;
  statusBasis: "confirmed" | "estimated";
}

const TRACKING = /^(utm_|fbclid|gclid|ref$|session)/i;

export function canonicalizeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null; // javascript: 등 차단
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let s = u.toString();
  if (u.pathname.length > 1 && s.endsWith("/") && !u.search) s = s.slice(0, -1);
  return s;
}

/**
 * 중복 판정용 사업명 정규화.
 * - [지역] 같은 대괄호 접두어는 유지한다(지역만 다른 별개 공고를 합치지 않기 위함).
 * - 재공고·연장·변경 같은 상태 표기 괄호만 제거한다.
 */
export function normalizeTitle(t: string): string {
  return t
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*(재공고|연장|변경|수정|정정|추가)[^)]*\)/g, " ")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

const clean = (s: string | undefined | null, max = 20000) => (s ?? "").replace(/\u0000/g, "").trim().slice(0, max);

export class ValidationError extends Error {}

export async function normalizeAnnouncement(raw: RawAnnouncement, today = seoulToday()): Promise<Normalized> {
  const title = clean(raw.title, 500);
  const organization = clean(raw.organization, 200);
  if (!clean(raw.sourceNoticeId, 200)) throw new ValidationError("sourceNoticeId 누락");
  if (!title) throw new ValidationError("사업명 누락");
  if (!organization) throw new ValidationError("지원기관 누락");
  const canonicalUrl = canonicalizeUrl(raw.url ?? "");
  if (!canonicalUrl) throw new ValidationError("원문 URL 이 올바르지 않음(http/https 만 허용)");
  const start = raw.applicationStart ?? null;
  const end = raw.applicationEnd ?? null;
  if (start && !isValidYmd(start)) throw new ValidationError("접수 시작일 형식 오류");
  if (end && !isValidYmd(end)) throw new ValidationError("접수 마감일 형식 오류");
  if (start && end && start > end) throw new ValidationError("접수 시작일이 마감일보다 늦음");
  const categories = [...new Set((raw.categories ?? []).filter((c) => CATEGORY_IDS.includes(c)))];
  for (const f of raw.files ?? []) if (!canonicalizeUrl(f.url)) throw new ValidationError("첨부파일 URL 오류");
  const { status, basis } = computeStatus(start, end, today, raw.confirmedStatus);
  const core = {
    t: title, o: organization, s: start, e: end, ta: raw.targetSummary ?? "", su: raw.supportSummary ?? "",
    el: raw.eligibilityText ?? "", ot: raw.originalText ?? "", rd: raw.requiredDocuments ?? "", am: raw.applicationMethod ?? "",
    ci: raw.contactInfo ?? "", c: categories, r: raw.regionScope ?? "전국",
  };
  return {
    ...raw,
    title,
    organization,
    sourceNoticeId: clean(raw.sourceNoticeId, 200),
    canonicalUrl,
    categories,
    regionScope: clean(raw.regionScope, 100) || "전국",
    normalizedTitle: normalizeTitle(title),
    contentHash: await sha256Hex(JSON.stringify(core)),
    status,
    statusBasis: basis,
  };
}

export type UpsertResult = { id: string; action: "inserted" | "updated" | "unchanged" | "merged" };

/** 중복 판정(우선순위: 원천ID → 정규화 URL → 기관+공고번호 → 정규화 사업명+기관+접수기간+해시) */
export async function findDuplicate(db: Db, sourceId: string, n: Normalized): Promise<{ id: string; by: string } | undefined> {
  let r = await db.get<{ id: string }>("SELECT id FROM announcements WHERE source_id=? AND source_notice_id=?", [sourceId, n.sourceNoticeId]);
  if (r) return { id: r.id, by: "source_id" };
  r = await db.get<{ id: string }>("SELECT id FROM announcements WHERE canonical_url=?", [n.canonicalUrl]);
  if (r) return { id: r.id, by: "canonical_url" };
  if (n.noticeNumber) {
    r = await db.get<{ id: string }>(
      "SELECT a.id FROM announcements a WHERE a.organization=? AND a.source_notice_id=?", [n.organization, n.noticeNumber]);
    if (r) return { id: r.id, by: "org_notice_no" };
  }
  // 지역 범위가 다른 공고는 사업명이 같아도 별개로 본다
  const cands = await db.all<{ id: string; title: string; content_hash: string }>(
    "SELECT id, title, content_hash FROM announcements WHERE organization=? AND region_scope=? AND COALESCE(application_start,'')=? AND COALESCE(application_end,'')=?",
    [n.organization, n.regionScope, n.applicationStart ?? "", n.applicationEnd ?? ""],
  );
  for (const c of cands) if (normalizeTitle(c.title) === n.normalizedTitle) return { id: c.id, by: "title_org_period" };
  return undefined;
}

async function writeChildren(db: Db, id: string, n: Normalized, now: string) {
  await db.run("DELETE FROM announcement_categories WHERE announcement_id=?", [id]);
  for (const c of n.categories) await db.run("INSERT INTO announcement_categories(announcement_id, category_id) VALUES (?,?)", [id, c]);
  await db.run("DELETE FROM announcement_files WHERE announcement_id=?", [id]);
  for (const f of n.files ?? []) {
    await db.run("INSERT INTO announcement_files(id, announcement_id, name, source_url, mime_type, size_bytes, collected_at) VALUES (?,?,?,?,?,?,?)",
      [newId(), id, clean(f.name, 300), canonicalizeUrl(f.url)!, f.mimeType ?? null, f.sizeBytes ?? null, now]);
  }
  if (n.rules) {
    await db.run("DELETE FROM eligibility_rules WHERE announcement_id=?", [id]);
    for (const r of n.rules) {
      await db.run(
        "INSERT INTO eligibility_rules(id, announcement_id, rule_type, field_key, operator, expected_value, source_excerpt, confidence) VALUES (?,?,?,?,?,?,?,?)",
        [newId(), id, "required", r.fieldKey, r.operator, JSON.stringify(r.expectedValue), r.sourceExcerpt ?? null, r.confidence ?? 1]);
    }
  }
}

function cols(sourceId: string, n: Normalized): SqlValue[] {
  return [
    n.canonicalUrl, n.title, n.organization, n.categories[0] ?? null, n.regionScope, n.targetSummary ?? null, n.supportSummary ?? null,
    n.supportAmountMin ?? null, n.supportAmountMax ?? null, n.supportAmountText ?? null, n.applicationStart ?? null, n.applicationEnd ?? null,
    n.status, n.statusBasis, n.eligibilityText ?? null, n.requiredDocuments ?? null, n.applicationMethod ?? null, n.contactInfo ?? null,
    n.originalText ?? null, n.publishedAt ?? null, n.contentHash,
  ];
}

export async function upsertAnnouncement(db: Db, sourceId: string, n: Normalized, changedBy: string): Promise<UpsertResult> {
  const now = nowIso();
  const dup = await findDuplicate(db, sourceId, n);
  if (!dup) {
    const id = newId();
    await db.run(
      `INSERT INTO announcements (id, source_id, source_notice_id, canonical_url, title, organization, category, region_scope, target_summary,
        support_summary, support_amount_min, support_amount_max, support_amount_text, application_start, application_end, application_status,
        status_basis, eligibility_text, required_documents, application_method, contact_info, original_text, published_at, content_hash,
        first_collected_at, last_checked_at, updated_at, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [id, sourceId, n.sourceNoticeId, ...cols(sourceId, n), now, now, now],
    );
    await db.run("INSERT INTO announcement_sources(announcement_id, source_id, source_notice_id, url, first_seen_at) VALUES (?,?,?,?,?)",
      [id, sourceId, n.sourceNoticeId, n.canonicalUrl, now]);
    // 이전에 다른 공고에 병합 기록돼 있던 같은 원천 공고ID 연결은 제거(자기 자신의 공고로 독립)
    await db.run("DELETE FROM announcement_sources WHERE source_id=? AND source_notice_id=? AND announcement_id<>?", [sourceId, n.sourceNoticeId, id]);
    await writeChildren(db, id, n, now);
    return { id, action: "inserted" };
  }
  const existing = await db.get<{ id: string; content_hash: string; source_id: string; source_notice_id: string; admin_locked: number }>(
    "SELECT id, content_hash, source_id, source_notice_id, admin_locked FROM announcements WHERE id=?", [dup.id]);
  if (!existing) throw new Error("dedupe race");
  // 다른 원천에서 온 동일 공고: 출처만 보존(병합)
  const sameSource = existing.source_id === sourceId && existing.source_notice_id === n.sourceNoticeId;
  await db.run("INSERT OR IGNORE INTO announcement_sources(announcement_id, source_id, source_notice_id, url, first_seen_at) VALUES (?,?,?,?,?)",
    [existing.id, sourceId, n.sourceNoticeId, n.canonicalUrl, now]);
  if (!sameSource) {
    await db.run("UPDATE announcements SET last_checked_at=? WHERE id=?", [now, existing.id]);
    return { id: existing.id, action: "merged" };
  }
  const byAdmin = changedBy.startsWith("admin:");
  if (existing.admin_locked && !byAdmin) {
    // 관리자 수정본은 수집으로 덮어쓰지 않음(최종 확인 시각만 갱신)
    await db.run("UPDATE announcements SET last_checked_at=? WHERE id=?", [now, existing.id]);
    return { id: existing.id, action: "unchanged" };
  }
  if (existing.content_hash === n.contentHash) {
    await db.run("UPDATE announcements SET last_checked_at=?, application_status=?, status_basis=? WHERE id=?", [now, n.status, n.statusBasis, existing.id]);
    return { id: existing.id, action: "unchanged" };
  }
  await db.run(
    `UPDATE announcements SET canonical_url=?, title=?, organization=?, category=?, region_scope=?, target_summary=?, support_summary=?,
      support_amount_min=?, support_amount_max=?, support_amount_text=?, application_start=?, application_end=?, application_status=?,
      status_basis=?, eligibility_text=?, required_documents=?, application_method=?, contact_info=?, original_text=?, published_at=?,
      content_hash=?, last_checked_at=?, updated_at=?, admin_locked=? WHERE id=?`,
    [...cols(sourceId, n), now, now, byAdmin ? 1 : existing.admin_locked, existing.id],
  );
  await db.run("INSERT INTO announcement_revisions(id, announcement_id, changed_at, changed_by, change_summary, old_content_hash, new_content_hash) VALUES (?,?,?,?,?,?,?)",
    [newId(), existing.id, now, changedBy, "내용 변경 감지", existing.content_hash, n.contentHash]);
  await writeChildren(db, existing.id, n, now);
  return { id: existing.id, action: "updated" };
}

/** 날짜 경과에 따른 접수 상태 재계산(원문 확인 상태는 유지). */
export async function refreshEstimatedStatuses(db: Db, today = seoulToday()): Promise<number> {
  const rows = await db.all<{ id: string; application_start: string | null; application_end: string | null; application_status: string }>(
    "SELECT id, application_start, application_end, application_status FROM announcements WHERE status_basis='estimated' AND is_active=1");
  let n = 0;
  for (const r of rows) {
    const { status } = computeStatus(r.application_start, r.application_end, today, null);
    if (status !== r.application_status) {
      await db.run("UPDATE announcements SET application_status=? WHERE id=?", [status, r.id]);
      n++;
    }
  }
  return n;
}
