import Link from "next/link";
export default function NotFound() {
  return (<><h1 className="text-xl font-bold">찾을 수 없는 페이지입니다.</h1><p className="mt-2"><Link href="/" className="underline">처음으로</Link></p></>);
}
