"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (<div role="alert" className="card p-8 text-center"><h1 className="text-xl font-bold">일시적인 오류가 발생했습니다</h1><p className="mt-2 text-sm">잠시 후 다시 시도해 주세요.</p><button className="btn mt-4" onClick={reset}>다시 시도</button></div>);
}
