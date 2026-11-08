#!/usr/bin/env bash
# 매일 DB 백업(무결성 확인 포함), 14일 보관. 필요 시 BACKUP_RCLONE_REMOTE 로 외부 저장소에 복사.
set -euo pipefail
BASE="${GOVBIZ_BASE:-/opt/govbiz}"
set -a; . "$BASE/shared/.env"; set +a
OUT="$BASE/shared/backups/prod-$(date +%Y%m%d-%H%M).sqlite"
sqlite3 "$DATABASE_PATH" ".backup '$OUT'"
[ "$(sqlite3 "$OUT" 'PRAGMA integrity_check;')" = "ok" ] || { echo "백업 무결성 실패"; rm -f "$OUT"; exit 1; }
gzip -f "$OUT"
find "$BASE/shared/backups" -name 'prod-*.sqlite.gz' -mtime +14 -delete
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then rclone copy "$OUT.gz" "$BACKUP_RCLONE_REMOTE"; fi
echo "백업 완료: $OUT.gz"
