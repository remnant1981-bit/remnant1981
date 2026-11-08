#!/usr/bin/env bash
# GovBiz Finder 국내 서버 1회 설치 스크립트 (Ubuntu 22.04/24.04, root 로 실행)
# 사용: sudo DOMAIN=example.kr ADMIN_EMAIL=me@example.com BIZINFO_API_KEY=xxxx bash setup-server.sh
# 하는 일: Node.js·Caddy 설치 → 전용 계정·디렉터리 → 비밀키 생성(.env) → 첫 배포 → systemd 서비스/타이머 등록
set -euo pipefail
: "${DOMAIN:?DOMAIN 필요(예: govbiz.example.kr)}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL 필요(관리자 로그인 이메일)}"
REPO="${REPO:-https://github.com/remnant1981-bit/remnant1981.git}"
BASE=/opt/govbiz
APP_SUBDIR=govbiz-finder

echo "[1/7] 패키지 설치"
apt-get update -y
apt-get install -y curl git sqlite3 debian-keyring debian-archive-keyring apt-transport-https ca-certificates gnupg
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "[2/7] 스왑(빌드 메모리 여유, 2GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[3/7] 계정·디렉터리"
id govbiz >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BASE" --shell /usr/sbin/nologin govbiz
mkdir -p "$BASE"/{releases,shared/data,shared/backups,repo}
[ -d "$BASE/repo/.git" ] || git clone --depth 50 "$REPO" "$BASE/repo"

echo "[4/7] 환경 파일(비밀키는 이 서버에서만 생성·보관)"
ENV="$BASE/shared/.env"
if [ ! -f "$ENV" ]; then
  ADMIN_PW="$(openssl rand -base64 18)"
  cat > "$ENV" <<CONF
NODE_ENV=production
PORT=3000
SITE_URL=https://${DOMAIN}
DATABASE_PATH=${BASE}/shared/data/prod.sqlite
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
APP_HMAC_KEY=$(openssl rand -base64 32)
APP_SESSION_PEPPER=$(openssl rand -base64 32)
BIZINFO_API_KEY=${BIZINFO_API_KEY:-}
DEV_AUTO_APPROVE_COMPANY=false
HEALTH_STALE_HOURS=26
NEXT_PUBLIC_ADSENSE_CLIENT=
NEXT_PUBLIC_ADSENSE_SLOT_LIST=
NEXT_PUBLIC_ADSENSE_SLOT_DETAIL=
NEXT_PUBLIC_ADSENSE_SLOT_HOME=
SEED_ADMIN_EMAIL=${ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=${ADMIN_PW}
SEED_WITH_MOCK=false
CONF
  echo ">>> 관리자 초기 비밀번호(1회만 표시, 바로 보관): ${ADMIN_PW}"
fi
chmod 600 "$ENV"
chown -R govbiz:govbiz "$BASE"

echo "[5/7] 첫 배포"
sudo -u govbiz -H bash "$BASE/repo/$APP_SUBDIR/deploy/release.sh"

echo "[6/7] systemd 서비스·타이머"
cp "$BASE/repo/$APP_SUBDIR/deploy/systemd/"*.service "$BASE/repo/$APP_SUBDIR/deploy/systemd/"*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now govbiz-web.service govbiz-collect.timer govbiz-backup.timer govbiz-update.timer
# 첫 수집 즉시 실행
systemctl start govbiz-collect.service || true

install -m 440 "$BASE/repo/$APP_SUBDIR/deploy/sudoers-govbiz" /etc/sudoers.d/govbiz
echo "[7/7] HTTPS(자동 인증서)"
sed "s/__DOMAIN__/${DOMAIN}/" "$BASE/repo/$APP_SUBDIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
echo "완료: https://${DOMAIN}  /  상태 점검: https://${DOMAIN}/api/health"
