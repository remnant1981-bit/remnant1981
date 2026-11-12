#!/usr/bin/env bash
# 운영 알림: 헬스체크 + 품질 리포트(ERROR 알림)를 확인해 문제가 있으면 웹훅으로 보냄(15분마다 cron).
# 사용: parking-alert              → 점검 후 필요 시 전송
#       parking-alert "<메시지>"   → 즉시 전송(수집 실패 등 다른 스크립트에서 호출)
# 웹훅: /etc/parking-save/env 의 ALERT_WEBHOOK_URL (Slack 호환 {"text"} + Discord 호환 {"content"} 동시 전송). 없으면 로그만 남김.
# 같은 내용은 6시간에 한 번만 다시 보냄(알림 폭주 방지). 비밀값·좌표는 메시지에 넣지 않음.
set -euo pipefail
ENV_FILE="${PARKING_ENV_FILE:-/etc/parking-save/env}"
BASE="${PARKING_BASE_URL:-http://127.0.0.1:3000}"
STATE_DIR="${PARKING_STATE_DIR:-/var/lib/parking-save}"
LOG="${PARKING_ALERT_LOG:-/var/log/parking-save-alert.log}"
RESEND_SEC=$((6 * 3600))
mkdir -p "$STATE_DIR"
envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
HOST="$(hostname)"

if [ $# -gt 0 ]; then
  MSG="$*"
else
  TOKEN="$(envval ADMIN_API_TOKEN)"
  HEALTH="$(curl -sS --max-time 10 "$BASE/api/health" || echo '{"status":"unreachable"}')"
  QUALITY="$(curl -sS --max-time 60 -H "Authorization: Bearer $TOKEN" "$BASE/api/admin/quality" || echo '{}')"
  MSG="$(HEALTH="$HEALTH" QUALITY="$QUALITY" python3 - <<'PY'
import json, os
out = []
try: h = json.loads(os.environ["HEALTH"])
except Exception: h = {"status": "unreachable"}
if h.get("status") != "ok":
    out.append(f"헬스체크 {h.get('status')}: {', '.join(h.get('issues', [])) or '응답 없음'}")
try: q = json.loads(os.environ["QUALITY"])
except Exception: q = {}
for a in q.get("alerts", []):
    if a.get("level") == "ERROR": out.append(f"[{a.get('code')}] {a.get('message')}")
print("\n".join(out))
PY
)"
fi

stamp="$(date '+%F %T')"
if [ -z "$MSG" ]; then echo "$stamp ok" >> "$LOG"; rm -f "$STATE_DIR/alert.last"; exit 0; fi

hash="$(printf '%s' "$MSG" | sha256sum | cut -c1-16)"
if [ -f "$STATE_DIR/alert.last" ]; then
  read -r last_hash last_ts < "$STATE_DIR/alert.last" || true
  if [ "${last_hash:-}" = "$hash" ] && [ $(( $(date +%s) - ${last_ts:-0} )) -lt $RESEND_SEC ]; then
    echo "$stamp 중복 알림 생략: $(echo "$MSG" | head -1)" >> "$LOG"; exit 0
  fi
fi
echo "$stamp ALERT $(echo "$MSG" | tr '\n' ' ')" >> "$LOG"
URL="$(envval ALERT_WEBHOOK_URL)"
if [ -n "$URL" ]; then
  BODY="$(TEXT="[파킹세이브 $HOST] $MSG" python3 -c 'import json,os;t=os.environ["TEXT"][:1900];print(json.dumps({"text":t,"content":t}))')"
  if curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' -d "$BODY" "$URL" -o /dev/null -w '%{http_code}' | grep -qE '^2'; then
    echo "$hash $(date +%s)" > "$STATE_DIR/alert.last"
  else
    echo "$stamp 웹훅 전송 실패" >> "$LOG"; exit 1
  fi
else
  echo "$hash $(date +%s)" > "$STATE_DIR/alert.last"
fi
