import { SearchForm } from "@/components/SearchForm";
import { SavedPanel } from "@/components/SavedPanel";
import { ActiveTimerBanner } from "@/components/ParkingTimer";
import { defaultStayInputs } from "@/lib/time";
import { MOCK_PLACES, mockEnabled } from "@/server/mock";

export const dynamic = "force-dynamic"; // 기본 시작·종료 시각을 요청 시점 기준으로 계산

export default function Home() {
  const defaults = defaultStayInputs();
  return (
    <>
      <h1 className="text-2xl font-bold">파킹세이브</h1>
      <p className="mb-6 mt-1 text-gray-700">주차하기 전에, 주차비부터 아끼자!</p>
      <ActiveTimerBanner />
      <SearchForm defaults={defaults} places={mockEnabled() ? Object.keys(MOCK_PLACES) : []} />
      <SavedPanel />
    </>
  );
}
