import type { Metadata } from "next";

export const metadata: Metadata = { title: "오프라인" };
export const dynamic = "force-static"; // 서비스 워커가 설치 시 미리 받아 두는 안내 화면

export default function Offline() {
  return (
    <>
      <h1 className="text-xl font-bold">인터넷에 연결되어 있지 않습니다</h1>
      <p className="mt-2 text-gray-700">주차 요금과 운영 여부는 최신 데이터로 계산해야 해서 오프라인에서는 검색할 수 없습니다. 연결된 뒤 다시 시도해 주세요.</p>
      {/* 전체 새로고침으로 네트워크를 다시 시도해야 하므로 클라이언트 이동(Link) 대신 일반 링크 사용 */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <p className="mt-4"><a href="/" className="underline">다시 시도</a></p>
    </>
  );
}
