import { SearchForm } from "@/components/SearchForm";
import { SavedPanel } from "@/components/SavedPanel";
import { ActiveTimerBanner } from "@/components/ParkingTimer";
import { HowItWorks } from "@/components/HowItWorks";
import { getAppDb } from "@/server/app-db";
import { STANDARD_SOURCE } from "@/collector/standard-api";
import { defaultStayInputs } from "@/lib/time";
import { MOCK_PLACES, mockEnabled } from "@/server/mock";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";

export const dynamic = "force-dynamic"; // 기본 시작·종료 시각을 요청 시점 기준으로 계산

export default async function Home() {
  const lang = await getLang();
  const t = dict(lang);
  const defaults = defaultStayInputs();
  // 표준데이터 마지막 성공 수집 시각(없으면 표시 안 함). DB 오류여도 홈은 열려야 하므로 실패는 무시
  let collectedAt: string | null = null;
  try {
    const db = await getAppDb();
    collectedAt = (await db.get<{ t: string | null }>("SELECT MAX(finished_at) AS t FROM source_sync_logs WHERE source_name=? AND status IN ('SUCCESS','PARTIAL')", [STANDARD_SOURCE]))?.t ?? null;
  } catch { collectedAt = null; }
  return (
    <>
      <h1 className="text-2xl font-bold">{lang === "en" ? "ParkingSave" : "파킹세이브"}</h1>
      <p className="mb-6 mt-1 text-gray-700">{t.home.tagline}</p>
      <ActiveTimerBanner lang={lang} />
      <SearchForm lang={lang} defaults={defaults} places={mockEnabled() ? Object.keys(MOCK_PLACES) : []} />
      <SavedPanel lang={lang} />
      <HowItWorks lang={lang} dataCollectedAt={collectedAt} />
    </>
  );
}
