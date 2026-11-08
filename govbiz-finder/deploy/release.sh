#!/usr/bin/env bash
# 무중단에 가까운 배포: 새 릴리스 폴더에서 설치·빌드·마이그레이션 성공 시에만 current 로 교체하고 재시작.
# 실패하면 기존 버전이 그대로 서비스된다(자동 롤백). govbiz 계정으로 실행.
set -euo pipefail
BASE="${GOVBIZ_BASE:-/opt/govbiz}"
APP_SUBDIR=govbiz-finder
cd "$BASE/repo"
git fetch --quiet origin main
SHA="$(git rev-parse --short origin/main)"
CUR="$(readlink -f "$BASE/current" 2>/dev/null || true)"
if [ "${FORCE:-0}" != "1" ] && [ "$CUR" = "$BASE/releases/$SHA/$APP_SUBDIR" ]; then echo "최신 상태($SHA)"; exit 0; fi

REL="$BASE/releases/$SHA"
rm -rf "$REL"; mkdir -p "$REL"
git --work-tree="$REL" checkout --quiet origin/main -- "$APP_SUBDIR"
cd "$REL/$APP_SUBDIR"
set -a; . "$BASE/shared/.env"; set +a
ln -sfn "$BASE/shared/data" data
npm ci --include=dev --no-audit --no-fund --loglevel=error   # NODE_ENV=production 이어도 빌드 도구 설치
npm run build
npm run db:migrate
# 최초 1회: 참조 데이터·관리자 계정(이미 있으면 건너뜀)
[ -f "$BASE/shared/.seeded" ] || { npm run db:seed && touch "$BASE/shared/.seeded"; }

ln -sfn "$REL/$APP_SUBDIR" "$BASE/current.new" && mv -Tf "$BASE/current.new" "$BASE/current"
sudo -n /bin/systemctl restart govbiz-web.service 2>/dev/null || echo "재시작 권한 없음: root 로 'systemctl restart govbiz-web' 실행 필요"
# 오래된 릴리스 정리(최근 3개 유지)
ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf
# 배포용 저장소 사본도 최신으로(다음 실행 때 새 배포 스크립트 사용)
git -C "$BASE/repo" reset --hard --quiet origin/main
echo "배포 완료: $SHA"
