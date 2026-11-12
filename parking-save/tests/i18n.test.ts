import { describe, expect, it } from "vitest";
import { parseLang, safeNext } from "@/i18n";
import { dict } from "@/i18n/dict";
import { labelsFor } from "@/lib/labels";
import { explainAll } from "@/domain/recommend";
import { clusterLabel } from "@/domain/cluster";
import { GET } from "@/app/lang/route";
import { NextRequest } from "next/server";
import { discountTargets, FEE_ANOMALY_LABEL } from "@/domain/fee-check";
import { calculateFee } from "@/domain/fee";

describe("화면 언어", () => {
  it("쿠키 값은 en만 영어, 나머지는 한국어", () => {
    expect(parseLang("en")).toBe("en");
    for (const v of ["ko", "EN", "", "fr", null, undefined]) expect(parseLang(v)).toBe("ko");
  });

  it("전환 후 이동 경로는 같은 사이트 경로만 허용(오픈 리다이렉트 차단)", () => {
    expect(safeNext("/search?lat=37.5&lng=127")).toBe("/search?lat=37.5&lng=127");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, "/a\r\nSet-Cookie: x=1", "/" + "a".repeat(2001)]) expect(safeNext(bad)).toBe("/");
  });

  it("/lang: 쿠키 저장 후 원래 화면으로 303, 외부 주소는 홈으로", () => {
    const r = GET(new NextRequest("http://localhost/lang?to=en&next=%2Fsearch%3Flat%3D37.5"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/search?lat=37.5");
    const c = r.cookies.get("ps-lang");
    expect(c?.value).toBe("en");
    expect(c?.httpOnly).toBe(true);
    expect(GET(new NextRequest("http://localhost/lang?to=xx&next=https%3A%2F%2Fevil.example")).headers.get("location")).toBe("/");
    expect(GET(new NextRequest("http://localhost/lang?to=xx")).cookies.get("ps-lang")?.value).toBe("ko");
  });

  it("영어 사전은 한국어와 같은 항목 수(목록·표 열 누락 없음)", () => {
    const ko = dict("ko"), en = dict("en");
    expect(en.how.steps).toHaveLength(ko.how.steps.length);
    expect(en.how.terms).toHaveLength(ko.how.terms.length);
    expect(en.report.cats.map((c) => c[0])).toEqual(ko.report.cats.map((c) => c[0]));
    expect(en.detail.dayCols).toHaveLength(ko.detail.dayCols.length);
    expect(en.detail.ruleCols).toHaveLength(ko.detail.ruleCols.length);
    expect(Object.keys(en.feeReason).sort()).toEqual(Object.keys(ko.feeReason).sort());
    expect(Object.keys(en.anomaly).sort()).toEqual(Object.keys(FEE_ANOMALY_LABEL).sort());
    expect(Object.keys(en.form.sorts)).toEqual(Object.keys(ko.form.sorts));
  });

  it("영어: 도메인이 돌려주는 감면 대상·고정 안내문을 모두 번역", () => {
    const en = labelsFor("en");
    const all = discountTargets("경차 저공해 장애인 국가유공자 다자녀 임산부 50% 감면");
    expect(all).toHaveLength(6);
    for (const k of all) expect(en.discountLabel(k)).not.toBe(k);
    // 일 최대요금이 있는 계산 결과의 notes 문구
    const f = calculateFee({ startAt: new Date("2026-11-16T10:00:00+09:00"), endAt: new Date("2026-11-16T12:00:00+09:00"), holidays: new Set(),
      rules: [{ id: 1, ruleType: "BASE", amount: 1000, durationMinutes: 60, dayType: "EVERYDAY", startTime: null, endTime: null }, { id: 3, ruleType: "ADDITIONAL", amount: 500, durationMinutes: 30, dayType: "EVERYDAY", startTime: null, endTime: null }, { id: 2, ruleType: "DAILY_MAX", amount: 5000, durationMinutes: null, dayType: "EVERYDAY", startTime: null, endTime: null, dailyMaxBasis: "CALENDAR_DAY" }] });
    expect(f.status).toBe("OK");
    if (f.status === "OK") { expect(f.notes?.length).toBeGreaterThan(0); for (const n of f.notes ?? []) expect(en.domainText(n)).not.toBe(n); }
  });

  it("영어 요금 문구: 계산 불가를 무료로 표시하지 않음", () => {
    const en = labelsFor("en");
    expect(en.feeText({ status: "UNKNOWN", reason: "NO_RULES" } as never)).toMatchObject({ main: "No fee info", tone: "unknown" });
    expect(en.feeText({ status: "OK", amount: 3000, isFree: false } as never).main).toBe("Est. ₩3,000");
    expect(labelsFor("ko").feeText({ status: "OK", amount: 3000, isFree: false } as never).main).toBe("예상 3,000원");
  });

  it("추천 사유·지도 묶음 라벨도 화면 언어를 따름(한국어 기본값 유지)", () => {
    const items = [
      { id: 1, distanceMeters: 100, fee: { status: "OK" as const, amount: 0, isFree: true }, operating: "OPERATING" as const, occupancy: { status: "UNAVAILABLE" as const }, ownershipType: "PUBLIC" as const },
      { id: 2, distanceMeters: 900, fee: { status: "UNKNOWN" as const }, operating: "UNKNOWN" as const, occupancy: { status: "UNAVAILABLE" as const }, ownershipType: "UNKNOWN" as const },
    ];
    const ko = explainAll(items), en = explainAll(items, "en");
    expect(ko.get(1)!.highlights).toContain("입력한 시간 전체 무료(시설 규칙 근거)");
    expect(en.get(1)!.highlights).toContain("Free for the whole stay (per facility rules)");
    expect(en.get(2)!.cautions).toHaveLength(ko.get(2)!.cautions.length);
    expect(en.get(2)!.cautions.join(" ")).not.toMatch(/[가-힣]/);
    const pins = [{ tone: "free" as const, amount: 0 }, { tone: "paid" as const, amount: 2000 }];
    expect(clusterLabel(pins)).toBe("2곳 · 무료 1 · 최저 2,000원");
    expect(clusterLabel(pins, "en")).toBe("2 lots · 1 free · from ₩2,000");
  });
});
