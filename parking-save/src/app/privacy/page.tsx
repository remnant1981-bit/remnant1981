import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "개인정보·위치정보 처리방침(초안)" };
export const dynamic = "force-static";

/** 실제 동작(코드) 기준으로 작성한 초안. 법률 검토 전이며, 확정 전 문구는 "확인 필요"로 표시 */
export default function Privacy() {
  return (
    <article className="space-y-5 text-sm leading-relaxed">
      <p role="note" className="rounded border border-amber-400 bg-amber-50 p-3 text-amber-900"><strong>초안</strong> — 법률 검토 전 문서입니다. 운영 주체·연락처·보관 기간 등 &lsquo;확인 필요&rsquo; 항목은 확정 후 갱신합니다.</p>
      <h1 className="text-xl font-bold">개인정보·위치정보 처리방침</h1>

      <section className="space-y-1"><h2 className="font-semibold">1. 회원가입·계정</h2>
        <p>파킹세이브는 회원가입이 없고 이름·연락처·이메일을 받지 않습니다.</p></section>

      <section className="space-y-1"><h2 className="font-semibold">2. 현재 위치</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>&lsquo;현재 위치 사용&rsquo;을 누르고 브라우저 위치 권한을 허용한 경우에만 사용합니다. 거부해도 목적지·주차장 이름으로 이용할 수 있습니다.</li>
          <li>좌표는 기기에서 소수 넷째 자리(약 11m)로 줄인 뒤 검색 요청에만 담아 보냅니다. 서버는 이 좌표를 데이터베이스에 저장하지 않습니다.</li>
          <li>결과 공유 시 좌표는 소수 셋째 자리(약 100m)로 더 줄여 링크에 담습니다.</li>
          <li>서버 접속 기록(웹 서버 로그)에는 주소의 검색 조건(좌표 포함)을 남기지 않도록 설정합니다.</li>
        </ul></section>

      <section className="space-y-1"><h2 className="font-semibold">3. 이 기기에만 저장되는 정보</h2>
        <p>즐겨찾기, 최근 검색(켠 경우에만), 주차 타이머는 이용자의 브라우저 저장소에만 저장되며 서버로 보내지 않습니다. 브라우저 데이터를 지우거나 화면의 삭제 기능으로 지울 수 있습니다.</p></section>

      <section className="space-y-1"><h2 className="font-semibold">4. 서버가 처리하는 정보</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>요청 제한</b>: 과도한 요청을 막기 위해 접속 IP 주소를 서버 메모리에서 최대 1시간 동안만 사용하며 데이터베이스에 저장하지 않습니다.</li>
          <li><b>정보 오류 신고</b>: 신고 유형·내용·시각과, 같은 신고의 반복을 막기 위해 IP 주소를 복원할 수 없게 변환한 값(앞 16자리)을 저장합니다. 신고 내용에 개인정보를 적지 마세요. 보관 기간: <em>확인 필요</em>.</li>
          <li><b>웹 서버 로그</b>: 접속 시각·IP 주소·요청 경로(검색 조건 제외)·응답 코드를 장애 대응 목적으로 보관합니다. 보관 기간: <em>확인 필요</em>.</li>
        </ul></section>

      <section className="space-y-1"><h2 className="font-semibold">5. 외부 서비스</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>지도 이미지</b>: &lsquo;지도&rsquo; 보기를 열면 브라우저가 OpenStreetMap 타일 서버에서 지도 이미지를 직접 받습니다. 이 과정에서 OpenStreetMap에 IP 주소와 보고 있는 지도 영역이 전달됩니다(OpenStreetMap 재단의 개인정보 정책 적용). 목록 보기만 쓰면 전달되지 않습니다.</li>
          <li><b>네이버 지도 앱</b>: 길찾기 버튼을 누르면 주차장 좌표·이름이 네이버 지도 앱으로 전달됩니다.</li>
        </ul></section>

      <section className="space-y-1"><h2 className="font-semibold">6. 문의</h2>
        <p>운영 주체·개인정보 보호책임자·연락처: <em>확인 필요</em></p></section>

      <p className="text-xs text-gray-600">시행일: <em>확인 필요</em> · <Link href="/terms" className="underline">이용약관</Link></p>
    </article>
  );
}
