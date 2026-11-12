"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeeRule } from "@/domain/fee";
import { startTimer, stopTimer, timerStatus, useTimer, type TimerHolidays } from "@/lib/parking-timer";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const hhmm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`);
const clock = (ms: number) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);

function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}

function Status({ now }: { now: number }) {
  const t = useTimer()!;
  const st = timerStatus(t, now);
  return (
    <div className="space-y-1" aria-live="polite">
      <p className="text-sm text-gray-700">{clock(Date.parse(t.startedAt))} 주차 시작 · 경과 {hhmm(st.elapsedMin)}</p>
      {st.kind === "OK" ? (
        <>
          <p className="text-lg font-bold tabular-nums">지금 나가면 {st.fee === 0 ? "무료" : won(st.fee)}</p>
          <p className="text-sm">{st.next ? <>다음 인상: <b>{clock(st.next.at)}</b> 이후 {won(st.next.fee)}</> : "24시간 안에 더 오르지 않습니다(일 최대요금 또는 무료)."}</p>
        </>
      ) : <p className="text-sm text-gray-700">요금을 계산할 수 없습니다: {st.reason}</p>}
      <p className="text-xs text-gray-600">원천 데이터 기준 예상 금액이며 현장 요금·할인과 다를 수 있습니다.</p>
    </div>
  );
}

/** 상세 화면: 이 주차장에서 타이머 시작/진행/종료 */
export function ParkingTimerPanel({ lotId, name, rules, holidays }: { lotId: number; name: string; rules: FeeRule[] | null; holidays: TimerHolidays | null }) {
  const t = useTimer();
  const now = useNow();
  if (!rules) return null; // 요금 규칙을 해석할 수 없는 시설은 타이머 미제공
  return (
    <section className="mt-4 rounded border border-gray-300 p-3" aria-labelledby="timer-h">
      <h2 id="timer-h" className="font-semibold">주차 타이머</h2>
      {!t && (
        <div className="mt-1 space-y-1">
          <p className="text-sm text-gray-700">주차를 시작하면 지금까지의 예상 요금과 다음 요금이 오르는 시각을 보여줍니다. 이 기기에만 저장됩니다.</p>
          <button type="button" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => startTimer({ lotId, name, rules, holidays })}>여기 주차 시작</button>
        </div>
      )}
      {t && t.lotId === lotId && (
        <div className="mt-1 space-y-2">
          <Status now={now} />
          <button type="button" className="rounded border border-gray-500 px-3 py-2 text-sm" onClick={stopTimer}>주차 종료(타이머 끄기)</button>
        </div>
      )}
      {t && t.lotId !== lotId && (
        <p className="mt-1 text-sm">다른 주차장(<Link href={`/lots/${t.lotId}`} className="underline">{t.name}</Link>)에서 타이머가 진행 중입니다. 그 화면에서 종료한 뒤 시작하세요.</p>
      )}
    </section>
  );
}

/** 홈 화면: 진행 중인 타이머 요약 */
export function ActiveTimerBanner() {
  const t = useTimer();
  const now = useNow();
  if (!t) return null;
  return (
    <section className="mb-6 rounded border border-blue-300 bg-blue-50 p-3" aria-labelledby="active-timer-h">
      <h2 id="active-timer-h" className="font-semibold"><Link href={`/lots/${t.lotId}`} className="underline">{t.name}</Link> 주차 중</h2>
      <Status now={now} />
    </section>
  );
}
