import { redirect } from "next/navigation";

// 공고 목록은 검색 화면이 담당한다
export default function Page() {
  redirect("/search");
}
