// 신청 진행 단계(화면·서버 공용)
export const STAGES = [
  { id: "interested", label: "관심", done: false },
  { id: "reviewing", label: "검토 중", done: false },
  { id: "preparing", label: "신청 준비", done: false },
  { id: "applied", label: "신청 완료", done: false },
  { id: "selected", label: "선정", done: true },
  { id: "rejected", label: "탈락", done: true },
  { id: "dropped", label: "포기", done: true },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export const STAGE_IDS = STAGES.map((s) => s.id) as readonly string[];
export const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;
