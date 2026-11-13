#!/usr/bin/env bash
# coupon-wallet/vendor/anthropic-sdk.js 재생성 (공식 @anthropic-ai/sdk를 브라우저용 단일 파일로 번들)
# 사용: scripts/coupon-wallet/build-vendor.sh [sdk-version]   예) 1.8.0  (생략 시 현재 고정 버전)
set -euo pipefail
VER="${1:-1.8.0}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm init -y >/dev/null
npm i --no-audit --no-fund "@anthropic-ai/sdk@${VER}" esbuild >/dev/null
printf "import Anthropic from '@anthropic-ai/sdk';\nglobalThis.Anthropic = Anthropic;\n" > entry.js
npx esbuild entry.js --bundle --minify --format=iife --platform=browser --target=chrome110 \
  --legal-comments=none --outfile="$ROOT/coupon-wallet/vendor/anthropic-sdk.js"
cp node_modules/@anthropic-ai/sdk/LICENSE "$ROOT/coupon-wallet/vendor/LICENSE-anthropic-sdk.txt"
echo "built @anthropic-ai/sdk@${VER}"
