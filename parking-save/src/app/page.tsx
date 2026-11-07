export default function Home() {
  return (
    <>
      <h1 className="text-2xl font-bold">파킹세이브</h1>
      <p className="mt-2">주차하기 전에, 주차비부터 아끼자!</p>
      <p role="status" className="mt-6 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
        개발 중: 아직 실제 주차장 데이터와 연동되지 않았습니다. 검색 기능은 준비 중입니다.
      </p>
    </>
  );
}
