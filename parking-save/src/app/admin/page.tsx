import type { Metadata } from "next";
import { AdminConsole } from "@/components/AdminConsole";

export const metadata: Metadata = { title: "관리자", robots: { index: false, follow: false } };

/** 관리자 화면. 운영 서버에서는 nginx가 외부 접근을 막으므로 SSH 터널로 접속(docs/DEPLOYMENT.md). 데이터는 토큰 인증 후 API로만 조회 */
export default function AdminPage() {
  return (
    <>
      <h1 className="text-xl font-bold">관리자</h1>
      <p className="mt-1 text-sm text-gray-700">신고·중복 후보 검토와 수집 상태 확인. 처리 내역은 감사로그에 남습니다.</p>
      <AdminConsole />
    </>
  );
}
