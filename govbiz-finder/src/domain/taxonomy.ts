export const CATEGORIES = [
  { id: "finance", name: "재정·금융", hint: "정책자금, 융자, 이차보전, 보증" },
  { id: "rnd", name: "R&D", hint: "국가연구개발, 기술개발" },
  { id: "commercialization", name: "기술·사업화", hint: "" },
  { id: "facility", name: "설비·시설", hint: "" },
  { id: "export", name: "수출·해외진출", hint: "" },
  { id: "marketing", name: "마케팅·판로", hint: "" },
  { id: "hr", name: "인력·고용", hint: "" },
  { id: "ip", name: "인증·지식재산", hint: "" },
  { id: "startup", name: "창업·벤처", hint: "" },
  { id: "regional", name: "지역특화", hint: "" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS: string[] = CATEGORIES.map((c) => c.id);
export const categoryName = (id: string | null | undefined) => CATEGORIES.find((c) => c.id === id)?.name ?? "미분류";

export const SIDO = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시",
  "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도",
] as const;

export const REVENUE_BANDS = ["10억 미만", "10억~50억", "50억~100억", "100억~400억", "400억 이상"] as const;
export const EMPLOYEE_BANDS = ["5명 미만", "5~9명", "10~49명", "50~99명", "100~299명", "300명 이상"] as const;

export const STATUS_LABEL: Record<string, string> = {
  upcoming: "접수 예정",
  open: "접수 중",
  closed: "마감",
  always: "상시 접수",
  unknown: "상태 확인 필요",
};
export const APP_STATUSES = Object.keys(STATUS_LABEL);

export const ENTERPRISE_SIZES = ["소상공인", "중소기업", "중견기업", "대기업"] as const;
export const INDUSTRY_GROUPS = ["제조업", "정보통신·SW", "콘텐츠·미디어", "도소매·유통", "농림축수산업", "관광·숙박·음식점", "건설업", "보건·의료", "기타 서비스업"] as const;
/** 주력 기술 분야와 공고명 인식 패턴(공고·기업 공용) */
export const TECH_FIELD_PATTERNS: [string, RegExp][] = [
  ["통신·네트워크(5G/6G)", /6G|5G|이동통신|통신망|통신장비|오픈랜|O-RAN|네트워크\s*장비|위성통신/i],
  ["반도체", /반도체|팹리스|파운드리/],
  ["디스플레이", /디스플레이|OLED|마이크로LED/i],
  ["이차전지·배터리", /이차전지|2차전지|배터리/],
  ["수소·에너지", /수소|연료전지|신재생|태양광|풍력|에너지저장|ESS|극저온|LNG/i],
  ["바이오·의료", /바이오|의약|제약|의료기기|헬스케어|디지털헬스|백신/],
  ["우주·항공", /우주|항공|위성|드론|UAM/],
  ["모빌리티·자동차", /자율주행|미래차|전기차|모빌리티|자동차부품|수소차/],
  ["로봇", /로봇/],
  ["조선·해양", /조선|해양플랜트|선박|화물창|해양기자재/],
  ["원자력", /원자력|원전|SMR/],
  ["양자", /양자/],
];
export const TECH_FIELDS = TECH_FIELD_PATTERNS.map(([n]) => n);
export function techFieldsIn(text: string | null | undefined): string[] {
  const t = text ?? "";
  return TECH_FIELD_PATTERNS.filter(([, re]) => re.test(t)).map(([n]) => n);
}
export const CERTIFICATIONS = ["벤처기업", "이노비즈", "메인비즈", "여성기업", "장애인기업", "사회적기업", "뿌리기업", "소부장 전문기업", "강소기업", "ISO 인증"] as const;

/** 기업정보 입력 항목(정확도 안내용 완성도 계산). */
export const PROFILE_KEYS = ["company_name", "representative_name", "region_sido", "region_sigungu", "industry_group", "industry_name", "established_at", "enterprise_size", "revenue_band", "employee_count_band", "export_status", "research_institute_status", "venture_status", "has_patent", "youth_ceo", "certifications", "tech_fields", "tech_keywords", "interest_categories"] as const;
export function profileCompleteness(c: Record<string, unknown> | null | undefined): { filled: number; total: number } {
  const filled = PROFILE_KEYS.filter((k) => { const v = c?.[k]; return typeof v === "string" && v.trim() !== ""; }).length;
  return { filled, total: PROFILE_KEYS.length };
}
