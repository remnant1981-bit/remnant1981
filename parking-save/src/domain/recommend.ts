// 규칙 기반 추천 사유 (RECOMMENDATION.md): 정렬 결과를 대체하지 않고, 각 시설이 왜 눈에 띄는지와 주의점을 설명한다.
// 원칙: 요금 정보가 없는 시설은 가격 비교에서 제외(낮은 점수를 주지 않음), 실시간 미제공은 감점하지 않음,
//       '최적'·'추천 1위' 같은 단정 표현을 쓰지 않는다.
export interface RecommendInput {
  id: number;
  distanceMeters: number;
  fee: { status: "OK" | "UNKNOWN"; amount?: number; isFree?: boolean };
  operating: "OPERATING" | "OUTSIDE" | "UNKNOWN";
  operatingAssumed?: boolean;
  occupancy: { status: "UNAVAILABLE" } | { status: "AVAILABLE"; availableSpaces: number; congestion: "RELAXED" | "NORMAL" | "BUSY" };
  ownershipType: "PUBLIC" | "UNKNOWN";
  /** 원천 요금 값이 이상해 보임(fee-check) — 최저가 강조에서 제외하고 유의점 표시 */
  feeWarnings?: string[];
}
export interface Explanation {
  /** 장점(칩): 라벨은 사실만 서술 */
  highlights: string[];
  /** 유의점: 거리·운영·혼잡·미확인 */
  cautions: string[];
}

/** 이 거리(직선) 이상이면 거리 유의점 표시 — 임시값, 사용자 이동 수단·선호 확인 후 조정(OPEN_ISSUES #6과 함께 검토) */
export const FAR_METERS = 700;

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);

export function explainAll(items: RecommendInput[]): Map<number, Explanation> {
  const out = new Map<number, Explanation>();
  const paid = items.filter((i) => i.fee.status === "OK" && !i.fee.isFree && !(i.feeWarnings?.length));
  const minPaid = paid.length >= 2 ? Math.min(...paid.map((i) => i.fee.amount!)) : null; // 비교 대상이 2곳 이상일 때만 '최저'
  const minDist = items.length >= 2 ? Math.min(...items.map((i) => i.distanceMeters)) : null;
  const maxAvail = Math.max(-1, ...items.map((i) => (i.occupancy.status === "AVAILABLE" ? i.occupancy.availableSpaces : -1)));

  for (const i of items) {
    const h: string[] = [], c: string[] = [];
    if (i.fee.status === "OK" && i.fee.isFree) h.push("입력한 시간 전체 무료(시설 규칙 근거)");
    else if (i.fee.status === "OK" && minPaid != null && i.fee.amount === minPaid && !(i.feeWarnings?.length)) h.push("요금 계산이 가능한 유료 시설 중 최저");
    if (minDist != null && i.distanceMeters === minDist) h.push("표시된 시설 중 가장 가까움(직선거리)");
    if (i.occupancy.status === "AVAILABLE") {
      if (i.occupancy.congestion === "RELAXED") h.push(`실시간 여유(잔여 ${i.occupancy.availableSpaces}면)`);
      if (i.occupancy.congestion === "BUSY") c.push(`실시간 혼잡(잔여 ${i.occupancy.availableSpaces}면)`);
      if (maxAvail > 0 && i.occupancy.availableSpaces === maxAvail && i.occupancy.congestion !== "BUSY" && !h.some((x) => x.startsWith("실시간 여유"))) h.push(`실시간 잔여면수 최다(${maxAvail}면)`);
    }
    if (i.distanceMeters >= FAR_METERS) c.push(`직선거리 ${km(i.distanceMeters)}로 다소 멉니다 — 실제 이동 거리는 더 길 수 있음`);
    if (i.fee.status !== "OK") c.push("요금을 계산하지 못해 요금 비교에서 제외됨");
    if (i.feeWarnings?.length) c.push("원천 요금 값이 이상해 보임 — 현장 요금 확인 필요");
    if (i.operatingAssumed) c.push("일요일 운영시간은 공휴일 규칙을 적용한 추정입니다 — 방문 전 확인 권장");
    if (i.operating === "OUTSIDE") c.push("이용 시간 중 운영시간 밖인 구간이 있음");
    else if (i.operating === "UNKNOWN") c.push("운영시간 정보 없음 — 이용 가능 여부 확인 필요");
    if (i.ownershipType === "UNKNOWN") c.push("공영 여부 미확인");
    out.set(i.id, { highlights: h, cautions: c });
  }
  return out;
}
