#!/usr/bin/env bash
# 최신 이미지로 교체 (데이터는 parking-data 볼륨에 유지). setup.sh가 /usr/local/bin/parking-update 로 설치.
set -euo pipefail
IMAGE="$(cat /etc/parking-save/image 2>/dev/null || echo ghcr.io/remnant1981-bit/parking-save:latest)"
[ "${PARKING_SKIP_PULL:-}" = 1 ] || docker pull "$IMAGE"   # 오프라인·로컬 이미지 검증 시 PARKING_SKIP_PULL=1
docker rm -f parking-save >/dev/null 2>&1 || true
# 앱 포트는 서버 안(127.0.0.1)에만 연다 — 외부 접근은 nginx(HTTPS)로만
docker run -d --name parking-save --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v parking-data:/data --env-file /etc/parking-save/env \
  --memory 700m --log-opt max-size=10m --log-opt max-file=3 "$IMAGE"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then echo "실행 중: $(curl -s http://127.0.0.1:3000/api/health)"; docker image prune -f >/dev/null; exit 0; fi
  sleep 2
done
echo "헬스체크 실패 — docker logs parking-save 확인"; exit 1
