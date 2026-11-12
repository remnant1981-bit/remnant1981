#!/usr/bin/env bash
# SQLite 온라인 백업(WAL 안전) → /var/backups/parking-save, 14일 보관
set -euo pipefail
DEST=/var/backups/parking-save; mkdir -p "$DEST"
STAMP=$(date +%F)
docker exec parking-save node -e "const {DatabaseSync}=require('node:sqlite');const f='/data/backup.sqlite';try{require('fs').unlinkSync(f)}catch{};new DatabaseSync('/data/parking.sqlite').exec(\"VACUUM INTO '\"+f+\"'\")" 2>/dev/null
# 백업본 무결성 확인 후에만 보관(깨진 백업이 정상 백업을 밀어내지 않게)
if ! docker exec parking-save node -e "const {DatabaseSync}=require('node:sqlite');const r=new DatabaseSync('/data/backup.sqlite',{readOnly:true}).prepare('PRAGMA integrity_check').all();process.exit(r.length===1&&r[0].integrity_check==='ok'?0:1)" 2>/dev/null; then
  docker exec parking-save rm -f /data/backup.sqlite
  command -v parking-alert >/dev/null && parking-alert "DB 백업 무결성 검사 실패($STAMP) — 이전 백업 유지" || true
  exit 1
fi
docker cp parking-save:/data/backup.sqlite "$DEST/parking-$STAMP.sqlite"
docker exec parking-save rm -f /data/backup.sqlite
find "$DEST" -name 'parking-*.sqlite' -mtime +14 -delete
