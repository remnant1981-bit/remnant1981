# ParkingSave 컨테이너 이미지 (플랫폼 중립: Lightsail·Fly.io·Naver Cloud 등 Docker 실행 가능한 곳 공통)
# DB는 SQLite 파일 → /data 볼륨에 영속화. 수집은 컨테이너 밖 스케줄러가 관리자 API를 호출(docs/DEPLOYMENT.md).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/parking.sqlite PARKING_MOCK_DATA=false
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# 마이그레이션 SQL은 첫 요청 시 process.cwd()/migrations 에서 적용됨
COPY --from=build --chown=node:node /app/migrations ./migrations
# 공유 이미지(OG)용 한글 글꼴(서버에서 fs로 읽음 — standalone 추적 대상이 아니라 명시 복사)
COPY --from=build --chown=node:node /app/assets ./assets
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
