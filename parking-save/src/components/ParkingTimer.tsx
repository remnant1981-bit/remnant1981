"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeeRule } from "@/domain/fee";
import { setAlertsOn, startTimer, stopTimer, timerAlerts, timerStatus, useAlertsOn, useTimer, type ParkingTimer, type TimerHolidays } from "@/lib/parking-timer";
import type { ScheduleRow } from "@/domain/operating";
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

type Perm = NotificationPermission | "unsupported";
const notifPerm = (): Perm => (typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");

/** 브라우저 알림(서비스 워커가 있으면 그쪽으로 — 안드로이드 크롬은 페이지 알림 생성자를 막음) */
async function notify(title: string, body: string, tag: string, url: string) {
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(title, { body, tag, icon: "/icons/icon-192.png", data: { url } }); return; }
    new Notification(title, { body, tag });
  } catch { /* 알림 실패는 화면 안 안내로 대신 */ }
}

const sentTags = new Set<string>(); // 같은 알림을 다시 예약할 때(재렌더) 중복 발송 방지

/** 알림 예약. 반환값은 예약 취소 함수. 이미 지난 사건은 timerAlerts에서 빠지고, 24시간 넘게 남은 알림은 예약하지 않음 */
function scheduleNotifications(timer: ParkingTimer, d: Dict): () => void {
  const now = Date.now();
  const ids = timerAlerts(timer, now).flatMap((a) => {
    const tag = `ps-${timer.startedAt}-${a.kind}-${a.at}`;
    const wait = a.notifyAt - now;
    if (sentTags.has(tag) || wait > 24 * 3600_000) return []; // 알림 시점이 지났어도 사건이 남았으면 바로 1회 알림
    return [window.setTimeout(() => {
      if (sentTags.has(tag)) return;
      sentTags.add(tag);
      const mins = Math.max(1, Math.round((a.at - Date.now()) / 60_000));
      notify(d.timer.notifyTitle(timer.name), a.kind === "FEE_UP" ? d.timer.soonFee(mins, d.money(a.fee ?? 0)) : d.timer.soonClose(mins), tag, `/lots/${timer.lotId}`);
    }, Math.max(0, wait))];
  });
  return () => ids.forEach((id) => window.clearTimeout(id));
}

/** 인상·종료 전 알림: 켜기/끄기, 예정 목록, 임박 안내(화면), 브라우저 알림 예약(페이지가 열려 있는 동안) */
function TimerAlerts({ timer, now, lang }: { timer: ParkingTimer; now: number; lang: Lang }) {
  const d = dict(lang), t = d.timer;
  const on = useAlertsOn();
  const [perm, setPerm] = useState<Perm>(notifPerm);
  const plan = timerAlerts(timer, now);
  const planKey = plan.map((a) => `${a.kind}@${a.at}`).join("|");
  useEffect(() => {
    if (!on || perm !== "granted") return;
    return scheduleNotifications(timer, d);
  }, [on, perm, planKey, timer, d]);
  const toggle = async () => {
    if (on) { setAlertsOn(false); return; }
    setAlertsOn(true);
    if (perm === "default") setPerm(await Notification.requestPermission().catch(() => "denied" as const));
  };
  const imminent = plan.filter((a) => now >= a.notifyAt);
  return (
    <div className="space-y-1 text-sm">
      {imminent.map((a) => (
        <p key={a.kind} role="alert" className="rounded border border-amber-500 bg-amber-50 p-2 font-semibold text-amber-900">
          {a.kind === "FEE_UP" ? t.soonFee(Math.max(1, Math.round((a.at - now) / 60_000)), d.money(a.fee ?? 0)) : t.soonClose(Math.max(1, Math.round((a.at - now) / 60_000)))}
        </p>
      ))}
      <button type="button" aria-pressed={on} onClick={toggle} className="rounded border border-gray-500 px-3 py-1.5">{on ? t.alertsOff : t.alertsOn}</button>
      {on && (
        <>
          {plan.length > 0 && <p className="text-gray-700">{t.upcoming} {plan.map((a) => a.kind === "FEE_UP" ? t.feeUp(clock(a.at, lang), d.money(a.fee ?? 0)) : t.closing(clock(a.at, lang))).join(" · ")}</p>}
          {!timer.schedules?.length && <p className="text-xs text-gray-600">{t.noClosing}</p>}
          {perm === "denied" && <p className="text-xs text-amber-800">{t.alertsDenied}</p>}
          {perm === "unsupported" && <p className="text-xs text-amber-800">{t.alertsUnsupported}</p>}
          <p className="text-xs text-gray-600">{t.alertsNote}</p>
        </>
      )}
    </div>
  );
}

/** 상세 화면: 이 주차장에서 타이머 시작/진행/종료 */
export function ParkingTimerPanel({ lotId, name, rules, holidays, schedules, lang = "ko" }: { lotId: number; name: string; rules: FeeRule[] | null; holidays: TimerHolidays | null; schedules?: ScheduleRow[]; lang?: Lang }) {
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
          <button type="button" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => startTimer({ lotId, name, rules, holidays, schedules })}>{L.start}</button>
        </div>
      )}
      {t && t.lotId === lotId && (
        <div className="mt-1 space-y-2">
          <Status now={now} lang={lang} />
          <TimerAlerts timer={t} now={now} lang={lang} />
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
      <TimerAlerts timer={t} now={now} lang={lang} />
    </section>
  );
}
