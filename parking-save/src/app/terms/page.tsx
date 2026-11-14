import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "이용약관(초안)" };
export const dynamic = "force-static";

export default function Terms() {
  return (
    <article className="space-y-5 text-sm leading-relaxed">
      <p role="note" className="rounded border border-amber-400 bg-amber-50 p-3 text-amber-900"><strong>초안</strong> — 법률 검토 전 문서입니다.</p>
      <h1 className="text-xl font-bold">이용약관</h1>

      <section className="space-y-1"><h2 className="font-semibold">1. 서비스 내용</h2>
        <p>파킹세이브는 공공데이터로 공개된 공영주차장 정보를 모아, 입력한 주차 시간 기준 예상 요금·운영 여부·거리를 비교해 보여주는 무료 정보 제공 서비스입니다. 주차장을 운영하거나 예약·결제를 대행하지 않습니다.</p></section>

      <section className="space-y-1"><h2 className="font-semibold">2. 정보의 정확성</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>요금·운영시간은 원천 데이터(전국주차장정보표준데이터 등)의 기준일 시점 정보로 계산한 <b>예상 금액</b>이며, 현장 요금·할인·임시 운영 변경과 다를 수 있습니다. 실제 요금은 현장 안내를 따릅니다.</li>
          <li>규칙이 확인되지 않은 시설은 요금을 추정하지 않고 &lsquo;계산 불가&rsquo;로 표시합니다. 정보가 없다는 것이 무료이거나 이용 가능하다는 뜻은 아닙니다.</li>
          <li>&lsquo;추정&rsquo;으로 표시된 항목(예: 일요일에 공휴일 운영시간 적용, 1일권을 일 최대요금으로 간주)은 원천에 명시되지 않은 부분을 보수적으로 해석한 것입니다.</li>
          <li>거리는 직선거리이며 실제 이동 거리와 다릅니다. 도보 시간은 직선거리에 일정 비율을 곱해 계산한 추정입니다.</li>
          <li>목적지 글자 검색은 주차장 이름·주소에 그 글자가 들어간 곳을 기준으로 잡은 <b>대략 위치</b>이며, 실제 목적지와 다를 수 있습니다.</li>
          <li>&lsquo;평소 혼잡 경향&rsquo;은 과거 실시간 관측의 평균이며 예측이 아닙니다. 실시간 잔여면수는 제공 기관의 관측 시각 기준입니다.</li>
          <li>&lsquo;관리자 보정 값&rsquo;으로 표시된 요금·운영시간은 운영자가 별도로 확인해 고친 값으로, 원천 데이터와 다를 수 있습니다.</li>
          <li>주차 타이머·알림은 이용자 기기에서 계산되는 참고용 기능이며, 브라우저를 닫으면 알림이 오지 않습니다. 출차 시각 판단에 단독으로 의존하지 마세요.</li>
        </ul></section>

      <section className="space-y-1"><h2 className="font-semibold">3. 데이터 출처</h2>
        <p>공공데이터포털 전국주차장정보표준데이터, 한국천문연구원 특일 정보, 서울 열린데이터광장(서울 실시간 잔여면수)을 이용합니다(각 시설 화면에 출처·기준일 표시). 지도 이미지 © OpenStreetMap contributors 또는 브이월드(국토교통부).</p></section>

      <section className="space-y-1"><h2 className="font-semibold">3-1. 정보 오류 신고</h2>
        <p>이용자가 보낸 신고는 운영자가 확인한 뒤 반영하며, 반영 여부와 시기를 보장하지 않습니다. 신고 내용에 개인정보를 적지 마세요.</p></section>

      <section className="space-y-1"><h2 className="font-semibold">4. 이용자의 의무</h2>
        <p>자동화된 대량 요청, 서비스 운영을 방해하는 행위, 허위 신고를 하지 않아야 합니다. 과도한 요청은 일시적으로 제한될 수 있습니다. 검색 엔진의 일반적인 수집은 허용합니다(robots.txt 기준).</p></section>

      <section className="space-y-1"><h2 className="font-semibold">4-1. 서비스 변경·중단</h2>
        <p>원천 데이터 제공 중단·변경, 점검, 장애로 서비스 일부 또는 전부가 바뀌거나 멈출 수 있습니다. 사전 고지 방법: <em>확인 필요</em></p></section>

      <section className="space-y-1"><h2 className="font-semibold">5. 책임의 한계</h2>
        <p>표시 정보와 실제 현장의 차이로 생긴 손해에 대한 책임 범위: <em>확인 필요(법률 검토)</em></p></section>

      <section className="space-y-1"><h2 className="font-semibold">6. 운영자·문의·준거법</h2>
        <p>운영 주체·연락처·관할 법원: <em>확인 필요(법률 검토)</em></p></section>

      <p className="text-xs text-gray-600">시행일: <em>확인 필요</em> · <Link href="/privacy" className="underline">개인정보·위치정보 처리방침</Link></p>
    </article>
  );
}
