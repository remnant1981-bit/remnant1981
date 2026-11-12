import Link from "next/link";
import { formatKst } from "@/lib/time";

/** 홈: 처음 온 이용자를 위한 계산 방식·표시 의미 안내(서버 렌더, 접혀 있음) */
export function HowItWorks({ dataCollectedAt }: { dataCollectedAt: string | null }) {
  return (
    <details className="mt-8 rounded border border-gray-300 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">파킹세이브는 이렇게 계산해요</summary>
      <div className="mt-2 space-y-3">
        <ol className="list-decimal space-y-1 pl-5">
          <li>목적지 근처나 현재 위치를 고르고, <b>주차 시작·종료 시각</b>을 넣습니다.</li>
          <li>반경 안의 공영주차장마다 그 시간의 <b>예상 요금</b>을 계산합니다. 평일·토요일·공휴일 요금, 무료 시간대, 일 최대요금을 반영합니다.</li>
          <li>무료 우선·요금 낮은 순·거리순으로 비교하고, 주차장을 고르면 네이버 지도로 길을 안내받습니다.</li>
        </ol>
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">계산 불가</dt><dd className="text-gray-700">요금 규칙이 원천 데이터에 없거나 불완전한 시설입니다. 0원으로 보지 않고 요금 비교에서 뺍니다.</dd>
          <dt className="font-semibold">추정</dt><dd className="text-gray-700">원천에 명시되지 않은 부분을 보수적으로 해석한 값입니다(예: 일요일에 공휴일 운영시간 적용). 방문 전 확인을 권합니다.</dd>
          <dt className="font-semibold">실시간 확인 불가</dt><dd className="text-gray-700">잔여면수를 실시간으로 제공하지 않는 시설입니다. 빈자리가 있다는 뜻이 아닙니다.</dd>
          <dt className="font-semibold">거리</dt><dd className="text-gray-700">직선거리입니다. 실제 이동 거리는 더 깁니다.</dd>
        </dl>
        <p className="text-gray-700">
          주차장 정보: 공공데이터포털 전국주차장정보표준데이터{dataCollectedAt ? ` (${formatKst(dataCollectedAt)} 수집)` : ""}. 요금은 예상 금액이며 현장 안내가 우선합니다.
          {" "}<Link href="/terms" className="underline">이용약관</Link> · <Link href="/privacy" className="underline">개인정보·위치정보 처리방침</Link>
        </p>
      </div>
    </details>
  );
}
