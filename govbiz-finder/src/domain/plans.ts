// 요금제 정의(가격·한도는 유료화 설계안의 가설값). 화면·서버 공용
export type PlanId = "free" | "pro" | "team";
export interface PlanLimits {
  /** 진행 중(선정·탈락·포기 제외)으로 관리할 수 있는 공고 수 */
  pipelineActive: number;
  /** 내보내기 1회 최대 행 수 */
  exportRows: number;
  /** 담당자 지정(팀 기능) */
  assignees: boolean;
  /** 광고 표시 */
  ads: boolean;
}
export interface PlanDef { id: PlanId; label: string; priceMonthly: number; priceYearly: number; seats: string; limits: PlanLimits; features: string[] }

export const EXPORT_MAX = 2000;
export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free", label: "무료", priceMonthly: 0, priceYearly: 0, seats: "1명",
    limits: { pipelineActive: 3, exportRows: 50, assignees: false, ads: true },
    features: ["공고 검색·상세·맞춤 추천(우선 추천 포함)", "관심 공고 저장·앱 내 알림", "신청 진행 관리 3건", "내보내기 50건"],
  },
  pro: {
    id: "pro", label: "Pro", priceMonthly: 19000, priceYearly: 190000, seats: "1명",
    limits: { pipelineActive: Number.POSITIVE_INFINITY, exportRows: EXPORT_MAX, assignees: false, ads: false },
    features: ["무료 기능 전체", "신청 진행 관리 무제한", "내보내기 무제한(1회 2,000건)", "광고 없음"],
  },
  team: {
    id: "team", label: "Team", priceMonthly: 49000, priceYearly: 490000, seats: "5명(추가 1명당 월 5,000원)",
    limits: { pipelineActive: Number.POSITIVE_INFINITY, exportRows: EXPORT_MAX, assignees: true, ads: false },
    features: ["Pro 기능 전체", "구성원 공유·담당자 지정", "신청 이력 팀 공유"],
  },
};
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
/** 요금제 제한을 끈 상태(판매 개시 전)의 한도: 모든 기능 사용 가능, 광고는 기존 설정 따름 */
export const UNLIMITED: PlanLimits = { pipelineActive: Number.POSITIVE_INFINITY, exportRows: EXPORT_MAX, assignees: true, ads: true };
