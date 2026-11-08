"use client";
import { useEffect, useState } from "react";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** 휴대폰 홈 화면에 추가 안내. 안드로이드(크롬)는 설치 버튼, 아이폰은 공유 → 홈 화면에 추가 안내. 이미 설치(앱 실행)면 숨김. */
export function InstallApp() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const onBip = (e: Event) => { e.preventDefault(); setEvt(e as BIP); setHidden(false); };
    window.addEventListener("beforeinstallprompt", onBip);
    // 브라우저 환경 감지는 마운트 후에만 가능(서버 렌더와 불일치 방지)
    const t = setTimeout(() => { setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent)); setHidden(standalone || !mobile); }, 0);
    return () => { window.removeEventListener("beforeinstallprompt", onBip); clearTimeout(t); };
  }, []);
  if (hidden) return null;
  return (
    <div className="no-print card mt-4 flex flex-wrap items-center gap-3 p-3 text-sm">
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--brand)] font-bold text-white">G</span>
      <span className="flex-1">휴대폰 홈 화면에 추가하면 앱처럼 바로 열 수 있습니다.</span>
      {evt ? <button type="button" className="btn" onClick={async () => { await evt.prompt(); setEvt(null); setHidden(true); }}>홈 화면에 추가</button>
        : ios ? <span className="text-[var(--muted)]">Safari 하단 <strong>공유(□↑)</strong> → <strong>홈 화면에 추가</strong></span>
        : <span className="text-[var(--muted)]">브라우저 메뉴(⋮) → <strong>홈 화면에 추가</strong></span>}
    </div>
  );
}
