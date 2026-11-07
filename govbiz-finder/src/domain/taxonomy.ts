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
