#!/usr/bin/env bash
# 관리자 수집 API 호출 (서버 안에서만 — nginx는 /api/admin 을 외부에 열지 않음)
# 사용: parking-sync standard-parking | holidays | seoul-occupancy
set -euo pipefail
JOB="${1:?job 필요: standard-parking | holidays | seoul-occupancy}"
TOKEN="$(grep -E '^ADMIN_API_TOKEN=' /etc/parking-save/env | cut -d= -f2-)"
LOG=/var/log/parking-save-sync.log
code=$(curl -sS -o /tmp/parking-sync-$JOB.json -w '%{http_code}' --max-time 300 -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"job\":\"$JOB\"}" http://127.0.0.1:3000/api/admin/sync || echo 000)
echo "$(date '+%F %T') $JOB HTTP $code $(head -c 300 /tmp/parking-sync-$JOB.json 2>/dev/null)" >> "$LOG"
if [ "$code" = 200 ] || [ "$code" = 409 ]; then exit 0; fi   # 409 = 이미 실행 중(정상)
# 서울 실시간은 키 미설정(400)이 정상일 수 있어 알림 제외. 나머지 실패는 알림(같은 내용은 6시간에 1회)
if [ "$JOB" != seoul-occupancy ] && command -v parking-alert >/dev/null; then parking-alert "수집 실패: $JOB (HTTP $code)" || true; fi
exit 1
