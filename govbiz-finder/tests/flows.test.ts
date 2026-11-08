import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { handlers } from "@/server/handlers";
import { client, freshDb, TODAY, type Client } from "./helpers";
import type { Db } from "@/server/db";
import { buildCsv, safeCell } from "@/export/csv";
import { generateNotifications } from "@/server/userdata";
import { runSource } from "@/collector/runner";

let db: Db;
const PW = "Passw0rdPassw0rd";
function validBiz(p9: string) { const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0; for (let i = 0; i < 9; i++) s += Number(p9[i]) * w[i]; s += Math.floor((Number(p9[8]) * 5) / 10); return p9 + ((10 - (s % 10)) % 10); }
const BIZ = validBiz("123456789");

async function member(email = "m@example.test"): Promise<Client> {
  const admin = await client(handlers);
  await admin.call("POST", "/api/auth/login", { email: "admin@example.test", password: "AdminPass12345" });
  await admin.call("GET", "/api/auth/me");
  const c = await client(handlers);
  await c.call("POST", "/api/auth/register", { email, password: PW });
  await c.call("GET", "/api/auth/me");
  await c.call("POST", "/api/company/claim", { bizNo: BIZ });
  const claim = ((await admin.call("GET", "/api/admin/claims")).body.items as any[]).find((x) => x.email === email);
  await admin.call("POST", "/api/admin/claims", { userId: claim.user_id, companyId: claim.company_id, decision: "approve" });
  return c;
}

beforeEach(async () => { db = await freshDb({ admin: true }); });

describe("사용자 시나리오 (TEST_PLAN §4)", () => {
  it("비회원이 R&D 공고를 검색하고 원문 링크·출처·최종확인 시각을 얻는다", async () => {
    const c = await client(handlers);
    const r = await c.call("GET", "/api/announcements?category=rnd&q=" + encodeURIComponent("R&D"));
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBeGreaterThan(0);
    for (const row of r.body.rows) {
      expect(row.canonical_url).toMatch(/^https?:\/\//);
      expect(row.last_checked_at).toBeTruthy();
      expect(row.source_status).toBe("mock"); // 테스트 데이터로 식별 가능
      expect(row.match).toBeNull(); // 비회원은 적합성 없음
    }
    const d = await c.call("GET", "/api/announcements/" + r.body.rows[0].id);
    expect(d.status).toBe(200);
    expect(d.body.match).toBeNull();
  });

  it("경기도/시흥시 지역 필터", async () => {
    const c = await client(handlers);
    const r = await c.call("GET", "/api/announcements?region=" + encodeURIComponent("경기도 시흥시"));
    const scopes = r.body.rows.map((x: any) => x.region_scope);
    expect(scopes).toContain("경기도 시흥시");
    expect(scopes).toContain("전국");
    expect(scopes).not.toContain("서울특별시");
  });

  it("사업자번호 상태조회(mock)는 테스트 데이터임을 알리고 전체 번호를 되돌려주지 않는다", async () => {
    const c = await client(handlers);
    const r = await c.call("POST", "/api/nts/status", { bizNo: BIZ });
    expect(r.status).toBe(200);
    expect(r.body.notice).toContain("테스트 데이터");
    expect(r.body.status.masked).toContain("**");
    expect(JSON.stringify(r.body)).not.toContain(BIZ);
    expect((await c.call("POST", "/api/nts/status", { bizNo: "1234567890" })).status).toBe(400); // 체크섬 오류
  });

  it("선택 정보만 입력해 추천을 받고 미입력 항목은 '확인 필요'로 나타난다(저장 안 함)", async () => {
    const c = await client(handlers);
    const r = await c.call("POST", "/api/match/preview", { profile: { region_sido: "경기도", research_institute_status: "yes" } });
    expect(r.status).toBe(200);
    expect(r.body.stored).toBe(false);
    const rnd = r.body.rows.find((x: any) => x.title.includes("기술개발(R&D)"));
    const states = Object.fromEntries(rnd.match.results.map((x: any) => [x.fieldKey, x.state]));
    expect(states.research_institute).toBe("MET");
    expect(states.business_status).toBe("UNKNOWN"); // 상태조회 안 했으므로 확인 필요
    expect(rnd.match.overall).toBe("needs_check");
    // 입력한 소재지(경기도)와 맞지 않는 서울시 공고는 결과에서 제외되고 제외 건수가 안내됨
    expect(r.body.rows.some((x: any) => x.title.includes("서울시"))).toBe(false);
    expect(r.body.excluded).toBeGreaterThan(0);
    expect(r.body.rows.every((x: any) => x.match.overall !== "likely_not_met")).toBe(true);
    expect(await db.get("SELECT 1 x FROM companies")).toBeUndefined(); // 어떤 것도 저장되지 않음
    // 지역 우선: 경기도 기업이면 경기도 공고가 서울 공고보다 앞
    const idx = (t: string) => r.body.rows.findIndex((x: any) => x.title.includes(t));
    expect(idx("경기도 중소기업")).toBeGreaterThanOrEqual(0);
    expect(idx("경기도 중소기업")).toBeLessThan(idx("스마트설비"));
    // 잘못된 입력 거부
    expect((await c.call("POST", "/api/match/preview", { profile: { revenue_band: "임의값" } })).status).toBe(400);
  });

  it("회원이 관심 공고를 저장하고 재로그인 후에도 확인한다 + 이력 기록", async () => {
    const c = await member();
    await c.call("PUT", "/api/company", { region_sido: "경기도", research_institute_status: "yes" });
    const list = await c.call("GET", "/api/announcements?q=" + encodeURIComponent("정책자금"));
    expect(list.body.hasCompany).toBe(true);
    expect(list.body.rows[0].match).toBeTruthy();
    const id = list.body.rows[0].id;
    expect((await c.call("POST", "/api/bookmarks", { announcementId: id })).status).toBe(200);
    expect((await c.call("GET", "/api/announcements/" + id)).body.bookmarked).toBe(true);
    await c.call("POST", "/api/auth/logout");
    const again = await client(handlers);
    expect((await again.call("POST", "/api/auth/login", { email: "m@example.test", password: PW })).status).toBe(200);
    await again.call("GET", "/api/auth/me");
    expect((await again.call("GET", "/api/bookmarks")).body.items.map((x: any) => x.id)).toEqual([id]);
    const h = (await again.call("GET", "/api/history")).body;
    expect(h.searches.length).toBeGreaterThan(0);
    expect(h.views.length).toBeGreaterThan(0);
    expect((await again.call("POST", "/api/bookmarks", { announcementId: "zzzz" })).status).toBe(404);
    expect((await again.call("DELETE", "/api/bookmarks", { announcementId: id })).status).toBe(200);
    expect((await again.call("GET", "/api/bookmarks")).body.items).toEqual([]);
  });

  it("기업 프로필 입력 검증·삭제(연쇄)", async () => {
    const c = await member();
    expect((await c.call("PUT", "/api/company", { established_at: "2999-01-01" })).status).toBe(400);
    expect((await c.call("PUT", "/api/company", { region_sido: "없는시도" })).status).toBe(400);
    const ok = await c.call("PUT", "/api/company", { company_name: "<script>alert(1)</script>", region_sido: "경기도" });
    expect(ok.body.company.business_number_masked).toMatch(/\*\*/);
    expect(JSON.stringify(ok.body)).not.toContain(BIZ);
    expect(ok.body.company.company_name).toBe("<script>alert(1)</script>"); // 저장은 원문, 출력은 React 가 인코딩
    await c.call("POST", "/api/bookmarks", { announcementId: (await c.call("GET", "/api/announcements")).body.rows[0].id });
    expect((await c.call("DELETE", "/api/company")).status).toBe(200);
    expect((await db.get<any>("SELECT COUNT(*) n FROM companies")).n).toBe(0);
    expect((await db.get<any>("SELECT COUNT(*) n FROM bookmarks")).n).toBe(0);
  });

  it("현재 검색 조건으로 CSV/XLSX/PDF 내보내기", async () => {
    const c = await member();
    await c.call("PUT", "/api/company", { region_sido: "경기도", established_at: "2024-01-01" });
    const q = "?category=rnd,finance&region=" + encodeURIComponent("경기도");
    const csv = await c.call("GET", "/api/export/csv" + q);
    const raw = Buffer.from(await csv.res.arrayBuffer());
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = raw.toString("utf8").replace(/^\uFEFF/, "");
    expect(csv.res.headers.get("content-type")).toContain("text/csv");
    expect(text).toContain("기업 적합성");
    expect(text.split("\r\n").length - 2).toBe((await c.call("GET", "/api/announcements" + q)).body.total);

    const x = await c.call("GET", "/api/export/xlsx" + q);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await x.res.arrayBuffer()) as any);
    const ws = wb.getWorksheet("공고 목록")!;
    expect(ws.rowCount - 1).toBe((await c.call("GET", "/api/announcements" + q)).body.total);
    expect(ws.getRow(1).getCell(1).value).toBe("분야");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(wb.getWorksheet("조회 조건")!.getRow(2).getCell(1).value).toContain("검색어");

    const pdf = await c.call("GET", "/api/export/pdf" + q);
    const buf = Buffer.from(await pdf.res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);

    // 비회원은 기업별(적합성) 열이 없다
    const anon = await client(handlers);
    const t = await (await anon.call("GET", "/api/export/csv" + q)).res.text();
    expect(t).not.toContain("기업 적합성");
    expect((await anon.call("GET", "/api/export/exe")).status).toBe(404);
  });

  it("CSV/XLSX 수식 주입 방지 및 이스케이프", () => {
    expect(safeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    for (const s of ["+1", "-1", "@a", "\tx"]) expect(safeCell(s).startsWith("'")).toBe(true);
    const csv = buildCsv([{ category: "a", title: 'a,"b"\n=cmd', organization: "o", region: "r", target: "t", support: "s", start: "", end: "", status: "s", fit: "", checks: "", url: "https://x.y", lastChecked: "", sourceNote: "" }], false);
    expect(csv).toContain('"a,""b""\n=cmd"');
    expect(csv).not.toContain(",=cmd");
  });
});

describe("알림", () => {
  it("설정에 따라 생성되고 동일 공고는 반복 알림되지 않는다", async () => {
    const c = await member();
    await c.call("PUT", "/api/company", { region_sido: "경기도" });
    expect((await c.call("PUT", "/api/notifications/settings", { type: "new_announcement", enabled: true })).status).toBe(200);
    expect((await c.call("PUT", "/api/notifications/settings", { type: "deadline_soon", enabled: true, deadlineDays: 5 })).status).toBe(200);
    expect((await c.call("PUT", "/api/notifications/settings", { type: "new_announcement", enabled: true, channel: "email" })).status).toBe(400); // 공급자 미설정
    const list = (await c.call("GET", "/api/announcements?q=" + encodeURIComponent("정책자금"))).body.rows;
    await c.call("POST", "/api/bookmarks", { announcementId: list[0].id }); // 마감 3일 후 공고
    const n1 = await generateNotifications(db, TODAY);
    expect(n1).toBeGreaterThan(0);
    expect(await generateNotifications(db, TODAY)).toBe(0); // 중복 방지
    const items = (await c.call("GET", "/api/notifications")).body.items as any[];
    expect(items.some((i) => i.type === "deadline_soon")).toBe(true);
    // 서울 전용 공고는 경기도 기업에게 신규 알림 제외
    expect(items.filter((i) => i.type === "new_announcement").some((i) => i.payload.title.includes("서울시"))).toBe(false);
    await c.call("POST", "/api/notifications/read");
    expect(((await c.call("GET", "/api/notifications")).body.items as any[]).every((i) => i.status === "read")).toBe(true);
    // 해제
    await c.call("PUT", "/api/notifications/settings", { type: "new_announcement", enabled: false });
    expect(((await c.call("GET", "/api/notifications/settings")).body.settings as any[]).find((s) => s.type === "new_announcement").enabled).toBe(false);
  });

  it("관심 공고 변경 감지 알림", async () => {
    const c = await member();
    await c.call("PUT", "/api/notifications/settings", { type: "bookmark_changed", enabled: true });
    const a = (await c.call("GET", "/api/announcements")).body.rows[0];
    await c.call("POST", "/api/bookmarks", { announcementId: a.id });
    await new Promise((r) => setTimeout(r, 5));
    await runSource(db, { sourceId: "mock", fetch: async () => [{ sourceNoticeId: (await db.get<any>("SELECT source_notice_id s FROM announcements WHERE id=?", [a.id])).s, url: a.canonical_url, title: a.title, organization: a.organization, categories: ["rnd"], supportSummary: "내용 변경됨", applicationStart: a.application_start, applicationEnd: a.application_end }] });
    expect(await generateNotifications(db, TODAY)).toBe(1);
  });
});

describe("관리자", () => {
  it("공고 수동 등록·수정·비활성화·감사 로그, 비활성 공고는 공개 검색/상세에서 제외", async () => {
    const admin = await client(handlers);
    await admin.call("POST", "/api/auth/login", { email: "admin@example.test", password: "AdminPass12345" });
    await admin.call("GET", "/api/auth/me");
    const created = await admin.call("POST", "/api/admin/announcements", { title: "수동 공고", organization: "기관", url: "https://example.org/m1", categories: ["finance"], applicationStart: "2020-01-01", applicationEnd: "2020-01-31", confirmedStatus: "open" });
    expect(created.status).toBe(200);
    const id = created.body.id;
    const pub = await client(handlers);
    expect((await pub.call("GET", "/api/announcements/" + id)).body.announcement.application_status).toBe("open"); // 원문 확인 상태 우선
    expect((await admin.call("PUT", "/api/admin/announcements/" + id, { title: "수동 공고(수정)", organization: "기관", url: "https://example.org/m1", categories: ["finance"] })).status).toBe(200);
    expect((await admin.call("PUT", "/api/admin/announcements/" + id, { isActive: false })).status).toBe(200);
    expect((await pub.call("GET", "/api/announcements/" + id)).status).toBe(404);
    const audit = (await admin.call("GET", "/api/admin/audit")).body.items.map((x: any) => x.action);
    expect(audit).toEqual(expect.arrayContaining(["announcement.create", "announcement.update", "announcement.deactivate"]));
    expect((await db.all("SELECT * FROM announcement_revisions WHERE announcement_id=?", [id])).length).toBeGreaterThanOrEqual(2);
    // 관리자 수정본은 수집으로 덮어쓰이지 않음
    const mockRow = (await db.get<any>("SELECT id, title FROM announcements WHERE source_id='mock' LIMIT 1"))!;
    const before = (await pub.call("GET", "/api/announcements/" + mockRow.id)).body.announcement;
    await admin.call("PUT", "/api/admin/announcements/" + mockRow.id, { title: "관리자 수정 제목", organization: before.organization, url: before.canonical_url, categories: ["rnd"] });
    await admin.call("POST", "/api/admin/collect", { sourceId: "mock" });
    expect((await pub.call("GET", "/api/announcements/" + mockRow.id)).body.announcement.title).toBe("관리자 수정 제목");
    // 미연동 원천은 활성화 불가, 수집 실행은 mock 만
    expect((await admin.call("PUT", "/api/admin/sources/mss", { enabled: true })).status).toBe(400);
    expect((await admin.call("POST", "/api/admin/collect", { sourceId: "bizinfo" })).status).toBe(400); // 키 미설정
    expect((await admin.call("POST", "/api/admin/collect", { sourceId: "mock" })).status).toBe(200);
  });
});
