import { ogImage, OG_SIZE } from "@/server/og";
import { getAppDb } from "@/server/app-db";
import { lotSummary } from "@/server/area";
import { dict } from "@/i18n/dict";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "주차장 요금 요약";

/** 주차장 공유 이미지: 이름·주소·유형·대표 요금(평일 기본요금·일 최대). 계산 불가는 '요금 정보 없음'(무료로 그리지 않음) */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = /^\d{1,9}$/.test(id) ? await lotSummary(await getAppDb(), Number(id)) : null;
  if (!s) return ogImage({ kicker: "파킹세이브", title: "공영주차장 요금 비교", lines: [], footer: "parking-save" });
  const t = dict("ko");
  const badge = s.fee.kind === "FREE" ? { text: "무료", tone: "free" as const }
    : s.fee.kind === "PAID" && s.fee.base ? { text: `${t.area.base(s.fee.base.minutes, t.money(s.fee.base.amount))}${s.fee.dailyMax != null ? ` · 일 최대 ${t.money(s.fee.dailyMax)}` : ""}`, tone: "paid" as const }
    : { text: "요금 정보 없음", tone: "unknown" as const };
  return ogImage({
    kicker: "파킹세이브 · 공영주차장", title: s.name,
    lines: [s.address ?? "", `${t.type[s.parkingType]}${s.totalSpaces != null ? ` · ${s.totalSpaces}면` : ""}`].filter(Boolean),
    badge, footer: `대표 요금(평일 기본) · 원천 기준일 ${s.updatedAt?.slice(0, 10) ?? "미확인"} · 실제 요금은 현장 안내 우선`,
  });
}
