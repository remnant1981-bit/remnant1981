import Link from "next/link";
export default function NotFound() {
  return (<div className="card p-8 text-center"><h1 className="text-xl font-bold">페이지를 찾을 수 없습니다</h1><p className="mt-2 text-sm"><Link className="underline" href="/search">공고 검색으로 이동</Link></p></div>);
}
