import { ogImage, OG_SIZE } from "@/server/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "파킹세이브 — 전국 공영주차장 요금 비교";

export default async function Image() {
  return ogImage({ kicker: "파킹세이브", title: "주차하기 전에, 주차비부터 아끼자!", lines: ["전국 공영주차장 · 시간대별 예상 요금 · 무료 주차장 비교"], footer: "공공데이터포털 전국주차장정보표준데이터 기준 · 요금은 예상 금액" });
}
