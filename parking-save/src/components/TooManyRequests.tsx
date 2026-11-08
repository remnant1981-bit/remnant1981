export function TooManyRequests({ retryAfterSec }: { retryAfterSec: number }) {
  return (
    <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-4">
      <p className="font-semibold">요청이 너무 많습니다.</p>
      <p className="mt-1 text-sm">약 {retryAfterSec}초 후에 다시 시도해 주세요.</p>
    </div>
  );
}
