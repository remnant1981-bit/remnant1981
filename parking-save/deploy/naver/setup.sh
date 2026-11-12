#!/usr/bin/env bash
# 파킹세이브 서버 설치 (네이버클라우드 Micro 등 Ubuntu 22.04/24.04 VM, root로 실행)
# 사용: sudo DOMAIN=parking.example.com EMAIL=admin@example.com bash setup.sh
#   - 다시 실행해도 안전(이미 된 단계는 건너뜀). 설치 후 업데이트는 update.sh.
#   - 이미지는 GitHub Actions가 GHCR에 올린 것을 받는다(서버에서 빌드하지 않음 — 1GB 메모리로는 빌드가 빠듯함).
set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN 필요 (예: parking.example.com — HTTPS 인증서 발급용, DNS A 레코드가 이 서버 공인 IP를 가리켜야 함)}"
EMAIL="${EMAIL:?EMAIL 필요 (HTTPS 인증서 만료 알림 수신용)}"
IMAGE="${IMAGE:-ghcr.io/remnant1981-bit/parking-save:latest}"
ENV_FILE=/etc/parking-save/env
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "root로 실행하세요 (sudo)"; exit 1; }

echo "== 1. 시간대·스왑 (1GB 메모리 보완)"
timedatectl set-timezone Asia/Seoul
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 2. 패키지 (docker, nginx, certbot)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io nginx certbot python3-certbot-nginx curl
systemctl enable --now docker nginx

echo "== 3. 환경변수 파일"
mkdir -p /etc/parking-save
if [ ! -f "$ENV_FILE" ]; then
  install -m 600 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOT
# 파킹세이브 운영 환경변수 (권한 600 유지, 저장소에 올리지 말 것)
SITE_URL=https://$DOMAIN
ADMIN_API_TOKEN=$(openssl rand -base64 33 | tr -d '\n')
ADMIN_AUDIT_SALT=$(openssl rand -hex 16)
TRUSTED_PROXY_COUNT=1
NODE_OPTIONS=--max-old-space-size=512
# 아래 키는 발급 후 입력하고 'bash update.sh' 실행
DATA_GO_KR_SERVICE_KEY=
SEOUL_OPENAPI_KEY=
EOT
  echo "   생성: $ENV_FILE (관리자 토큰은 무작위로 채움)"
fi

echo "== 4. 이미지 받기·실행"
if ! docker pull "$IMAGE"; then
  echo "이미지를 받지 못했습니다. GHCR 패키지가 비공개면 먼저 로그인하세요:"
  echo "  docker login ghcr.io -u <GitHub 사용자명>   (비밀번호 자리에 read:packages 권한 토큰)"
  exit 1
fi
echo "$IMAGE" > /etc/parking-save/image
install -m 755 "$HERE/update.sh" /usr/local/bin/parking-update
/usr/local/bin/parking-update

echo "== 5. nginx 리버스 프록시"
sed "s/__DOMAIN__/$DOMAIN/g" "$HERE/nginx.conf" > /etc/nginx/sites-available/parking-save
ln -sf /etc/nginx/sites-available/parking-save /etc/nginx/sites-enabled/parking-save
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== 6. HTTPS 인증서 (Let's Encrypt)"
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

echo "== 7. 정기 수집·백업 (cron, KST)"
install -m 755 "$HERE/parking-sync.sh" /usr/local/bin/parking-sync
install -m 755 "$HERE/parking-backup.sh" /usr/local/bin/parking-backup
cat > /etc/cron.d/parking-save <<'EOT'
# 파킹세이브 정기 작업 (시간대: Asia/Seoul)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# 표준데이터: 매일 04:17
17 4 * * *   root parking-sync standard-parking
# 공휴일: 매주 월 04:47 (커버리지 유효기간 7일)
47 4 * * 1   root parking-sync holidays
# 서울 실시간: 5분마다 (키가 없으면 400으로 끝나며 로그만 남음)
*/5 * * * *  root parking-sync seoul-occupancy
# DB 백업: 매일 03:37, 14일 보관
37 3 * * *   root parking-backup
EOT

echo "== 완료"
echo "확인: curl -s https://$DOMAIN/api/health"
echo "다음: $ENV_FILE 에 인증키 입력 → parking-update → parking-sync holidays → parking-sync standard-parking"
