"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded border border-red-400 bg-red-50 p-4">
      <p className="font-semibold">일시적인 오류가 발생했습니다.</p>
      <button type="button" onClick={reset} className="mt-2 rounded border border-gray-500 px-3 py-2 text-sm">다시 시도</button>
    </div>
  );
}
