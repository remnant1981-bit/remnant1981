#!/usr/bin/env bash
# SQLite 온라인 백업(WAL 안전) → /var/backups/parking-save, 14일 보관
set -euo pipefail
DEST=/var/backups/parking-save; mkdir -p "$DEST"
STAMP=$(date +%F)
docker exec parking-save node -e "const {DatabaseSync}=require('node:sqlite');const f='/data/backup.sqlite';try{require('fs').unlinkSync(f)}catch{};new DatabaseSync('/data/parking.sqlite').exec(\"VACUUM INTO '\"+f+\"'\")" 2>/dev/null
docker cp parking-save:/data/backup.sqlite "$DEST/parking-$STAMP.sqlite"
docker exec parking-save rm -f /data/backup.sqlite
find "$DEST" -name 'parking-*.sqlite' -mtime +14 -delete
