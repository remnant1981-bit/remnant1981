import type { RawAnnouncement } from "@/domain/announcements";
import type { SourceAdapter } from "./types";

function addDays(ymd: string, d: number): string {
  const t = new Date(ymd + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

/**
 * 테스트(모의) 데이터. 실제 공고가 아니며 UI 에 '테스트 데이터'로 표시된다.
 * 기준일(today)에 대한 상대 날짜로 접수예정/접수중/마감임박/마감 상태를 모두 만든다.
 * 원문 URL 은 예약 도메인(example.org)이다.
 */
export function buildMockAnnouncements(today: string): RawAnnouncement[] {
  const u = (n: number) => `https://example.org/mock-notice/${n}`;
  return [
    {
      sourceNoticeId: "MOCK-001", url: u(1), title: "[테스트] 중소기업 기술개발(R&D) 지원사업", organization: "테스트 중소벤처기관",
      categories: ["rnd", "commercialization"], regionScope: "전국", targetSummary: "기업부설연구소 보유 중소기업",
      supportSummary: "기술개발 과제 연구비 지원", supportAmountMax: 500000000, supportAmountText: "최대 5억원",
      applicationStart: addDays(today, -10), applicationEnd: addDays(today, 20),
      eligibilityText: "기업부설연구소 또는 연구개발전담부서를 보유한 중소기업. 사업자 상태가 계속사업자일 것.",
      requiredDocuments: "사업계획서, 사업자등록증 사본", applicationMethod: "온라인 접수(테스트)", contactInfo: "02-000-0000(테스트)",
      originalText: "이 공고는 개발용 테스트 데이터입니다.",
      rules: [
        { fieldKey: "research_institute", operator: "eq", expectedValue: "yes", sourceExcerpt: "기업부설연구소 또는 연구개발전담부서를 보유한 중소기업" },
        { fieldKey: "business_status", operator: "eq", expectedValue: "계속사업자", sourceExcerpt: "사업자 상태가 계속사업자일 것" },
      ],
    },
    {
      sourceNoticeId: "MOCK-002", url: u(2), title: "[테스트] 경기도 중소기업 정책자금 융자", organization: "테스트 경기도청",
      categories: ["finance", "regional"], regionScope: "경기도", targetSummary: "경기도 소재 중소기업",
      supportSummary: "운전·시설자금 융자 및 이차보전", supportAmountText: "업체당 최대 10억원",
      applicationStart: addDays(today, -5), applicationEnd: addDays(today, 3),
      eligibilityText: "경기도 내 사업장 소재 중소기업.",
      rules: [{ fieldKey: "region_sido", operator: "in", expectedValue: ["경기도"], sourceExcerpt: "경기도 내 사업장 소재 중소기업" }],
    },
    {
      sourceNoticeId: "MOCK-003", url: u(3), title: "[테스트] 시흥시 중소기업 판로개척 지원", organization: "테스트 시흥산업진흥기관",
      categories: ["marketing", "regional"], regionScope: "경기도 시흥시", targetSummary: "시흥시 소재 중소기업",
      supportSummary: "전시회 참가비 지원", applicationStart: addDays(today, 5), applicationEnd: addDays(today, 30),
      eligibilityText: "시흥시 소재 중소기업.",
      rules: [
        { fieldKey: "region_sido", operator: "in", expectedValue: ["경기도"] },
        { fieldKey: "region_sigungu", operator: "in", expectedValue: ["시흥시"], sourceExcerpt: "시흥시 소재 중소기업" },
      ],
    },
    {
      sourceNoticeId: "MOCK-004", url: u(4), title: "[테스트] 수출 초보기업 해외진출 바우처", organization: "테스트 수출지원기관",
      categories: ["export"], regionScope: "전국", targetSummary: "수출 실적이 없거나 적은 중소기업",
      supportSummary: "해외 마케팅 바우처", supportAmountText: "최대 3천만원",
      applicationStart: addDays(today, -30), applicationEnd: addDays(today, -2),
      eligibilityText: "수출실적이 없는 중소기업.", rules: [{ fieldKey: "export", operator: "eq", expectedValue: "no", sourceExcerpt: "수출실적이 없는 중소기업" }],
    },
    {
      sourceNoticeId: "MOCK-005", url: u(5), title: "[테스트] 청년 창업 초기기업 사업화 지원", organization: "테스트 창업진흥기관",
      categories: ["startup", "commercialization"], regionScope: "전국", targetSummary: "업력 3년 이내 창업기업",
      supportSummary: "사업화 자금 지원", applicationStart: addDays(today, -3), applicationEnd: addDays(today, 40),
      eligibilityText: "업력 3년 이내 창업기업.", rules: [{ fieldKey: "business_age_years", operator: "lte", expectedValue: 3, sourceExcerpt: "업력 3년 이내" }],
    },
    {
      sourceNoticeId: "MOCK-006", url: u(6), title: "[테스트] 벤처기업 성장 인증 연계 지원", organization: "테스트 벤처지원기관",
      categories: ["ip", "startup"], regionScope: "전국", targetSummary: "벤처기업 확인을 받은 기업",
      supportSummary: "지식재산 출원 비용 지원", applicationStart: addDays(today, -2), applicationEnd: addDays(today, 6),
      eligibilityText: "벤처기업 확인서를 보유한 기업.", rules: [{ fieldKey: "venture", operator: "eq", expectedValue: "yes", sourceExcerpt: "벤처기업 확인서를 보유한 기업" }],
    },
    {
      sourceNoticeId: "MOCK-007", url: u(7), title: "[테스트] 제조 현장 스마트설비 도입 지원", organization: "테스트 산업진흥원",
      categories: ["facility"], regionScope: "전국", targetSummary: "제조업 영위 중소기업",
      supportSummary: "설비 도입비 일부 지원", applicationStart: null, applicationEnd: null,
      confirmedStatus: "always", eligibilityText: "제조업 영위 중소기업(상시 접수).",
      rules: [{ fieldKey: "industry", operator: "contains_any", expectedValue: ["제조"], sourceExcerpt: "제조업 영위 중소기업" }],
    },
    {
      sourceNoticeId: "MOCK-008", url: u(8), title: "[테스트] 중소기업 인력 채용 장려금", organization: "테스트 고용기관",
      categories: ["hr"], regionScope: "전국", targetSummary: "상시근로자 50인 미만 기업",
      supportSummary: "신규 채용 인건비 지원", applicationStart: addDays(today, -1), applicationEnd: addDays(today, 60),
      eligibilityText: "상시근로자 50인 미만 기업.", rules: [{ fieldKey: "employee_band", operator: "in", expectedValue: ["5명 미만", "5~9명", "10~49명"], sourceExcerpt: "상시근로자 50인 미만" }],
    },
    {
      sourceNoticeId: "MOCK-009", url: u(9), title: "[테스트] 일정 미정 기술사업화 공모(상태 불명)", organization: "테스트 기술사업화기관",
      categories: ["commercialization"], regionScope: "전국", targetSummary: "중소기업", supportSummary: "세부 일정은 원문 확인 필요",
      applicationStart: null, applicationEnd: null, eligibilityText: "",
    },
    {
      sourceNoticeId: "MOCK-010", url: u(10), title: "[테스트] 서울시 소상공인 마케팅 지원", organization: "테스트 서울시",
      categories: ["marketing", "regional"], regionScope: "서울특별시", targetSummary: "서울 소재 소상공인",
      supportSummary: "온라인 마케팅비", applicationStart: addDays(today, 10), applicationEnd: addDays(today, 25),
      rules: [{ fieldKey: "region_sido", operator: "in", expectedValue: ["서울특별시"] }],
    },
  ];
}

export class MockAdapter implements SourceAdapter {
  readonly sourceId = "mock";
  constructor(private today: string) {}
  async fetch() {
    return buildMockAnnouncements(this.today);
  }
}
