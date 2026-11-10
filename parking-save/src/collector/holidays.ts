// 공휴일 수집: 한국천문연구원 특일 정보(공공데이터포털 15012690).
// ⚠ 미검증: 공식 페이지에는 기념일 오퍼레이션 명세만 표시되며, 공휴일 오퍼레이션명(getRestDeInfo)과 JSON 응답 형태는
//   2차 자료 기준이다. 필드명(locdate, isHoliday, dateName, dateKind, seq, resultCode)은 공식 응답 표 기준.
//   API 키로 실응답을 확인하기 전에는 운영 사용 금지. 테스트는 명세 기반 합성 응답을 사용한다.
import type { Db } from "@/server/db";
import { finishedIso, kstYmd } from "@/lib/time";
import { normalizeServiceKey } from "./service-key";

export const HOLIDAY_SOURCE = "KASI_SPCDE";
export const KASI_BASE_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService";
/** 커버리지 유효 기간: 마지막 성공 수집이 이보다 오래되면 공휴일 판정 불가로 본다(임시공휴일 지정 누락 위험) */
export const HOLIDAY_COVERAGE_MAX_AGE_DAYS = 7;

export interface HolidayEntry { date: string; seq: number; name: string; dateKind: string }
const netCode = (e: unknown): string => {
  const c = (e as { cause?: { code?: unknown }; name?: unknown })?.cause?.code ?? (e as { name?: unknown })?.name;
  return typeof c === "string" && /^[A-Za-z0-9_]{1,40}$/.test(c) ? c : "UNKNOWN";
};
export class HolidayApiError extends Error { constructor(readonly code: string, msg: string) { super(msg); } }

const validYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const fmt = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

function toEntries(items: Array<Record<string, unknown>>): HolidayEntry[] {
  const out: HolidayEntry[] = [];
  for (const it of items) {
    if (String(it.isHoliday ?? "").trim() !== "Y") continue; // 휴일 여부 Y만 (기념일 등 제외)
    const loc = String(it.locdate ?? "").trim();
    if (!/^\d{8}$/.test(loc) || !validYmd(fmt(loc))) throw new HolidayApiError("BAD_DATE", "날짜 형식 오류");
    out.push({ date: fmt(loc), seq: Number(it.seq) > 0 ? Number(it.seq) : 1, name: String(it.dateName ?? "").trim(), dateKind: String(it.dateKind ?? "").trim() });
  }
  return out;
}

/** JSON 또는 XML 본문 → 공휴일 항목. 오류 응답(resultCode≠00, 게이트웨이 오류)은 HolidayApiError */
export function parseHolidayResponse(body: string): { entries: HolidayEntry[]; totalCount: number } {
  const t = body.trim();
  if (t.startsWith("{")) {
    let j: any;
    try { j = JSON.parse(t); } catch { throw new HolidayApiError("BAD_RESPONSE", "응답 파싱 실패"); }
    if (j.response?.header == null) {
      const code = j.cmmMsgHeader?.returnReasonCode ?? j.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode;
      throw new HolidayApiError(String(code ?? "BAD_RESPONSE"), "게이트웨이 오류 응답");
    }
    const code = String(j.response.header.resultCode ?? "");
    if (code !== "00") throw new HolidayApiError(code || "BAD_RESPONSE", "원천 오류 응답");
    const items = j.response.body?.items;
    const raw = !items || items === "" ? [] : Array.isArray(items.item) ? items.item : items.item ? [items.item] : [];
    return { entries: toEntries(raw), totalCount: Number(j.response.body?.totalCount ?? raw.length) };
  }
  if (t.startsWith("<")) {
    const gw = /<returnReasonCode>(\w+)<\/returnReasonCode>/.exec(t);
    if (gw) throw new HolidayApiError(gw[1], "게이트웨이 오류 응답");
    const code = /<resultCode>(\w+)<\/resultCode>/.exec(t)?.[1];
    if (code !== "00") throw new HolidayApiError(code ?? "BAD_RESPONSE", "원천 오류 응답");
    const tag = (blk: string, n: string) => new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(blk)?.[1];
    const raw = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => Object.fromEntries(["locdate", "seq", "dateKind", "isHoliday", "dateName"].map((n) => [n, tag(m[1], n)])));
    return { entries: toEntries(raw), totalCount: Number(tag(t, "totalCount") ?? raw.length) };
  }
  throw new HolidayApiError("BAD_RESPONSE", "알 수 없는 응답 형식");
}

export type MonthFetcher = (year: number, month: number) => Promise<string>;

/** HTTP 클라이언트(키는 환경변수로만 주입). 오류 메시지·로그에 URL/키를 포함하지 않는다 */
export function kasiMonthFetcher(opts: { serviceKey: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number }): MonthFetcher {
  const f = opts.fetchImpl ?? fetch;
  return async (year, month) => {
    const u = new URL(`${opts.baseUrl ?? KASI_BASE_URL}/getRestDeInfo`);
    u.searchParams.set("serviceKey", normalizeServiceKey(opts.serviceKey));
    u.searchParams.set("solYear", String(year));
    u.searchParams.set("solMonth", String(month).padStart(2, "0"));
    u.searchParams.set("numOfRows", "100");
    u.searchParams.set("pageNo", "1");
    u.searchParams.set("_type", "json");
    let res: Response;
    try { res = await f(u.toString(), { signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) }); } // URL 객체 대신 문자열(tsx 등에서 연결 실패 확인)
    catch (e) { throw new HolidayApiError("NETWORK", `원천 연결 실패(${netCode(e)})`); }
    if (!res.ok) throw new HolidayApiError(`HTTP_${res.status}`, "원천 HTTP 오류");
    return res.text();
  };
}

export interface HolidaySyncSummary {
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  years: Array<{ year: number; complete: boolean; reason?: string; count: number }>;
  coverage: { from: string; to: string } | null;
}

/**
 * 당해·다음 해를 월별 수집. 연도가 "완전"하려면 12개월 모두 성공하고 canary(1/1, 12/25 고정 공휴일)가 있어야 한다
 * (아직 미공표인 연도가 '공휴일 없음'으로 오인되는 것 방지). 완전한 연속 구간만 커버리지로 선언한다.
 * 쓰기 순서: 커버리지 삭제 → 공휴일 교체 → 커버리지 기록. 중간 실패 시 커버리지가 없어 안전하게 '판정 불가'가 된다.
 * 수집 실패 시 기존 데이터·커버리지는 건드리지 않는다.
 */
export async function syncHolidays(db: Db, fetchMonth: MonthFetcher, now = new Date(), source = HOLIDAY_SOURCE): Promise<HolidaySyncSummary> {
  const y0 = Number(kstYmd(now.getTime()).slice(0, 4));
  const startedAt = now.toISOString();
  const t0 = performance.now();
  const logId = (await db.run("INSERT INTO source_sync_logs(source_name, started_at, status) VALUES (?,?, 'RUNNING')", [source, startedAt])).lastId;
  const years: HolidaySyncSummary["years"] = [];
  const collected: HolidayEntry[] = [];
  let lastErr: string | null = null;
  for (const year of [y0, y0 + 1]) {
    const entries: HolidayEntry[] = [];
    let reason: string | undefined;
    for (let m = 1; m <= 12 && !reason; m++) {
      try {
        const { entries: e, totalCount } = parseHolidayResponse(await fetchMonth(year, m));
        if (totalCount > 100) reason = "PAGINATION_UNSUPPORTED"; // 월 공휴일/특일이 100건 초과는 비정상
        else entries.push(...e);
      } catch (err) {
        reason = err instanceof HolidayApiError ? `API_${err.code}` : "UNKNOWN_ERROR";
        lastErr = reason;
      }
    }
    if (!reason && !(entries.some((e) => e.date === `${year}-01-01`) && entries.some((e) => e.date === `${year}-12-25`))) reason = "CANARY_MISSING";
    years.push({ year, complete: !reason, reason, count: entries.length });
    if (reason) break; // 이후 연도는 연속 구간이 아니므로 중단
    collected.push(...entries);
  }
  const done = years.filter((y) => y.complete);
  let coverage: HolidaySyncSummary["coverage"] = null;
  if (done.length > 0) {
    const to = `${done[done.length - 1].year}-12-31`;
    coverage = { from: `${y0}-01-01`, to };
    await db.run("DELETE FROM holiday_coverage WHERE source_name=?", [source]);
    await db.run("DELETE FROM holidays WHERE source_name=? AND date BETWEEN ? AND ?", [source, coverage.from, to]);
    for (const h of collected) {
      await db.run("INSERT OR REPLACE INTO holidays(date, seq, name, date_kind, source_name, collected_at) VALUES (?,?,?,?,?,?)", [h.date, h.seq, h.name, h.dateKind, source, startedAt]);
    }
    await db.run("INSERT INTO holiday_coverage(source_name, from_date, to_date, collected_at) VALUES (?,?,?,?)", [source, coverage.from, to, startedAt]);
  }
  const status = done.length === 0 ? "FAILED" : done.length === 2 ? "SUCCESS" : "PARTIAL";
  await db.run("UPDATE source_sync_logs SET finished_at=?, status=?, records_received=?, records_inserted=?, error_summary=? WHERE id=?",
    [finishedIso(now, t0), status, collected.length, collected.length, status === "SUCCESS" ? null : `공휴일 수집 ${status}: ${years.filter((y) => !y.complete).map((y) => `${y.year}년 ${y.reason}`).join(", ") || lastErr}`, logId]);
  return { status, years, coverage };
}
