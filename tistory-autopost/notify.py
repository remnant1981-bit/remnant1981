"""
휴대폰 알림 (선택): 발행 결과·리포트를 푸시로 받기

- ntfy (가입 불필요): 휴대폰에 ntfy 앱 설치 → 아무도 못 맞힐 주제 이름 구독 → 환경변수 NTFY_TOPIC
  (자체 서버면 NTFY_SERVER, 기본 https://ntfy.sh)
- 텔레그램: 봇 토큰 TELEGRAM_BOT_TOKEN + 채팅 ID TELEGRAM_CHAT_ID
둘 다 없으면 아무것도 하지 않음. 알림 실패는 본 작업에 영향 없음.
"""

import base64
import json
import os
import sys
import urllib.parse
import urllib.request


def _run_url() -> str:
    s, r, i = (os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
    return f"{s}/{r}/actions/runs/{i}" if s and r and i else ""


def send(title: str, message: str, url: str = "", priority: str = "default") -> bool:
    url = url or _run_url()
    sent = False
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if topic:
        server = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
        # ntfy 헤더는 ASCII 만 안전 → 한글 제목은 RFC 2047 인코딩
        headers = {"Title": "=?UTF-8?B?" + base64.b64encode(title.encode()).decode() + "?=",
                   "Priority": priority, "Tags": "memo"}
        if url:
            headers["Click"] = url
        try:
            req = urllib.request.Request(f"{server}/{urllib.parse.quote(topic)}",
                                         data=message.encode("utf-8"), headers=headers, method="POST")
            urllib.request.urlopen(req, timeout=15).read()
            sent = True
        except Exception as e:
            print(f"[알림] ntfy 실패: {e}", file=sys.stderr)
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN", ""), os.environ.get("TELEGRAM_CHAT_ID", "")
    if token and chat:
        text = f"<b>{_esc(title)}</b>\n{_esc(message)}" + (f'\n<a href="{url}">실행 결과 보기</a>' if url else "")
        body = json.dumps({"chat_id": chat, "text": text[:4000], "parse_mode": "HTML",
                           "disable_web_page_preview": True}).encode()
        try:
            req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=body,
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=15).read()
            sent = True
        except Exception as e:
            print(f"[알림] 텔레그램 실패: {e}", file=sys.stderr)
    return sent


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    # 예: python notify.py "제목" "내용" [high]
    ok = send(sys.argv[1] if len(sys.argv) > 1 else "테스트",
              sys.argv[2] if len(sys.argv) > 2 else "알림 테스트",
              priority=sys.argv[3] if len(sys.argv) > 3 else "default")
    print("전송됨" if ok else "알림 설정 없음 (NTFY_TOPIC 또는 TELEGRAM_* 필요)")
