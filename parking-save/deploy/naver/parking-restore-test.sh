#!/usr/bin/env bash
# 백업 복원 리허설: 가장 최근(또는 지정한) 백업을 운영 컨테이너와 분리된 임시 컨테이너(네트워크 없음, 읽기 전용)에서 열어
# 무결성·외래키·마이그레이션·시설 수를 확인. 운영 DB는 건드리지 않음. 주 1회 cron, 실패 시 parking-alert.
# 사용: parking-restore-test [백업파일]
set -euo pipefail
DEST="${PARKING_BACKUP_DIR:-/var/backups/parking-save}"
FILE="${1:-$(ls -1t "$DEST"/parking-*.sqlite 2>/dev/null | head -1 || true)}"
IMAGE="$(cat /etc/parking-save/image 2>/dev/null || echo ghcr.io/remnant1981-bit/parking-save:latest)"
LOG="${PARKING_RESTORE_LOG:-/var/log/parking-save-restore-test.log}"
fail() { echo "$(date '+%F %T') FAIL $*" | tee -a "$LOG"; command -v parking-alert >/dev/null && parking-alert "백업 복원 리허설 실패: $*" || true; exit 1; }
[ -n "$FILE" ] && [ -f "$FILE" ] || fail "백업 파일 없음($DEST)"
RES="$(docker run --rm --network none --memory 400m -v "$(readlink -f "$FILE")":/restore/db.sqlite:ro "$IMAGE" node -e '
const {DatabaseSync}=require("node:sqlite");const fs=require("fs");
const d=new DatabaseSync("/restore/db.sqlite",{readOnly:true});
const integ=d.prepare("PRAGMA integrity_check").all().map(r=>r.integrity_check);
const fk=d.prepare("PRAGMA foreign_key_check").all().length;
const applied=new Set(d.prepare("SELECT name FROM schema_migrations").all().map(r=>r.name));
const missing=fs.readdirSync("/app/migrations").filter(f=>f.endsWith(".sql")&&!applied.has(f));
const lots=d.prepare("SELECT COUNT(*) c FROM parking_lots WHERE data_status NOT LIKE '"'"'EXCLUDED%'"'"'").get().c;
const ok=integ.length===1&&integ[0]==="ok"&&fk===0&&lots>0;
console.log(JSON.stringify({ok,integrity:integ.slice(0,3),fk,missingMigrations:missing,lots}));
process.exit(ok?0:1);' 2>/dev/null)" || fail "$(basename "$FILE"): ${RES:-열기 실패}"
echo "$(date '+%F %T') OK $(basename "$FILE") $RES" | tee -a "$LOG"
# 이미지가 백업보다 새 마이그레이션을 갖는 건 정상(복원 후 첫 요청에서 적용됨) — 정보로만 남김
