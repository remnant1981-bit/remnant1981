import { distanceMeters } from "@/domain/geo";

export interface DedupeLot { id: number; name: string; roadAddress: string | null; latitude: number | null; longitude: number | null }
export interface DuplicateCandidate { lotA: number; lotB: number; score: number; reason: string }

const nameKey = (n: string) => n.replace(/\s+/g, "").replace(/(공영)?주차장$/, "").replace(/\(.*?\)/g, "").toLowerCase();
const addrKey = (a: string | null) => (a ? a.replace(/\s+/g, "") : "");

/** 중복 '후보'만 산출한다. 자동 병합하지 않으며 확정은 관리자 승인(ADMIN_DATA.md). */
export function findCandidates(a: DedupeLot, b: DedupeLot): DuplicateCandidate | null {
  if (a.id === b.id || a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const d = distanceMeters({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
  const na = nameKey(a.name), nb = nameKey(b.name);
  const sameName = na !== "" && na === nb;
  const partialName = na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na));
  // 실데이터 표본에서 같은 도로명주소를 쓰는 '제2/제3주차장', '공항1/공항2'가 후보로 올라오는 오탐 확인 → 이름 유사성을 필수로 하고, 번호가 서로 다르면 제외
  const numA = (a.name.match(/\d+/g) ?? []).join(","), numB = (b.name.match(/\d+/g) ?? []).join(",");
  if (numA !== "" && numB !== "" && numA !== numB) return null;
  if (!sameName && !partialName) return null;
  const sameAddr = addrKey(a.roadAddress) !== "" && addrKey(a.roadAddress) === addrKey(b.roadAddress);
  let score = 0; const why: string[] = [];
  if (sameName && d <= 150) { score += 0.6; why.push("동일 시설명·150m 이내"); }
  if (sameAddr && d <= 150) { score += 0.3; why.push("동일 도로명주소"); }
  if (d <= 15) { score += 0.2; why.push("15m 이내"); }
  if (score < 0.5) return null;
  const [lotA, lotB] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return { lotA, lotB, score: Math.min(1, Number(score.toFixed(2))), reason: `${why.join(", ")} (거리 ${Math.round(d)}m)` };
}
