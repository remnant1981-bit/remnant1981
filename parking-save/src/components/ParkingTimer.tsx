"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeeRule } from "@/domain/fee";
import { startTimer, stopTimer, timerStatus, useTimer, type TimerHolidays } from "@/lib/parking-timer";
import type { Lang } from "@/i18n";
import { dict, type Dict } from "@/i18n/dict";
import { LOCALE } from "@/i18n";


const clock = (ms: number, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);

function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}

function Status({ now, lang }: { now: number; lang: Lang }) {
  const d: Dict = dict(lang), t = d.timer, won = d.money;
  const tm = useTimer()!;
  const st = timerStatus(tm, now);
  return (
    <div className="space-y-1" aria-live="polite">
      <p className="text-sm text-gray-700">{t.started(clock(Date.parse(tm.startedAt), lang), t.hm(st.elapsedMin))}</p>
      {st.kind === "OK" ? (
        <>
          <p className="text-lg font-bold tabular-nums">{t.now(st.fee === 0 ? d.fee.free : won(st.fee))}</p>
          <p className="text-sm">{st.next ? <>{t.next} <b>{clock(st.next.at, lang)}</b>{t.after(won(st.next.fee))}</> : t.noRise}</p>
        </>
      ) : <p className="text-sm text-gray-700">{t.unknown(lang === "ko" ? st.reason : (d.feeReason[st.code] ?? d.fee.unknownSub))}</p>}
      <p className="text-xs text-gray-600">{t.note}</p>
    </div>
  );
}

/** 상세 화면: 이 주차장에서 타이머 시작/진행/종료 */
export function ParkingTimerPanel({ lotId, name, rules, holidays, lang = "ko" }: { lotId: number; name: string; rules: FeeRule[] | null; holidays: TimerHolidays | null; lang?: Lang }) {
  const t = useTimer();
  const L = dict(lang).timer;
  const now = useNow();
  if (!rules) return null; // 요금 규칙을 해석할 수 없는 시설은 타이머 미제공
  return (
    <section className="mt-4 rounded border border-gray-300 p-3" aria-labelledby="timer-h">
      <h2 id="timer-h" className="font-semibold">{L.title}</h2>
      {!t && (
        <div className="mt-1 space-y-1">
          <p className="text-sm text-gray-700">{L.intro}</p>
          <button type="button" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => startTimer({ lotId, name, rules, holidays })}>{L.start}</button>
        </div>
      )}
      {t && t.lotId === lotId && (
        <div className="mt-1 space-y-2">
          <Status now={now} lang={lang} />
          <button type="button" className="rounded border border-gray-500 px-3 py-2 text-sm" onClick={stopTimer}>{L.stop}</button>
        </div>
      )}
      {t && t.lotId !== lotId && (
        <p className="mt-1 text-sm">{L.other1}<Link href={`/lots/${t.lotId}`} className="underline">{t.name}</Link>{L.other2}</p>
      )}
    </section>
  );
}

/** 홈 화면: 진행 중인 타이머 요약 */
export function ActiveTimerBanner({ lang = "ko" }: { lang?: Lang }) {
  const t = useTimer();
  const now = useNow();
  if (!t) return null;
  return (
    <section className="mb-6 rounded border border-blue-300 bg-blue-50 p-3" aria-labelledby="active-timer-h">
      <h2 id="active-timer-h" className="font-semibold"><Link href={`/lots/${t.lotId}`} className="underline">{t.name}</Link> {dict(lang).timer.parked}</h2>
      <Status now={now} lang={lang} />
    </section>
  );
}
