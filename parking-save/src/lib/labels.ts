import type { FeeView, LotItem } from "@/server/search";
import { dict } from "@/i18n/dict";
import { LOCALE, type Lang } from "@/i18n";

// 한국어 기본 라벨(기존 호출부 호환). 화면 언어가 필요한 곳은 labelsFor(lang) 사용
const KO = dict("ko");
export const won = KO.money;
export const distLabel = KO.dist;
export const TYPE_LABEL = KO.type;
export const OWNERSHIP_LABEL = KO.ownership;
export const OPERATING_LABEL = KO.operating;
export const DAY_LABEL = KO.day;
export const RULE_LABEL = KO.rule;
export const FEE_REASON_LABEL = KO.feeReason;

type FeeText = { main: string; sub?: string; tone: "free" | "paid" | "unknown" };

export function labelsFor(lang: Lang) {
  const t = dict(lang);
  const feeText = (f: FeeView): FeeText => {
    if (f.status === "OK") return f.isFree ? { main: t.fee.free, sub: t.fee.freeSub, tone: "free" } : { main: t.fee.estimate(f.amount!), sub: f.assumptions?.[0] ? t.fee.capAssumed : undefined, tone: "paid" };
    return { main: t.fee.unknown, sub: t.feeReason[f.reason ?? ""] ?? t.fee.unknownSub, tone: "unknown" };
  };
  const occupancyText = (o: LotItem["occupancy"]): { main: string; sub?: string } => {
    if (o.status === "UNAVAILABLE") return { main: t.occ.unavailable };
    const time = new Date(o.observedAt).toLocaleTimeString(LOCALE[lang], { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
    return { main: t.occ.main(o.availableSpaces, o.totalSpaces), sub: t.occ.asOf(t.occ.level[o.congestion], time) };
  };
  /** 출처 표시명: 목업/샘플은 실데이터가 아님을 명시 */
  const sourceLabel = (name: string) => t.source[name] ?? name;
  /** 감면 대상 라벨(도메인은 한국어 라벨을 돌려줌) */
  const discountLabel = (k: string) => t.discount[k] ?? k;
  /** 도메인 고정 안내문 번역(없으면 원문) */
  const domainText = (s: string) => t.feeText[s] ?? s;
  return { t, feeText, occupancyText, sourceLabel, discountLabel, domainText };
}

const KO_LABELS = labelsFor("ko");
export const feeText = KO_LABELS.feeText;
export const occupancyText = KO_LABELS.occupancyText;
export const sourceLabel = KO_LABELS.sourceLabel;
