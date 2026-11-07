# 실행·배포 가이드
## 로컬
README 참조. 테스트는 인메모리 SQLite 사용(`npm test`).
## 운영 필수 설정(승인 후 수행 — 운영 배포·실키 등록·도메인·이메일·유료서비스는 미실행)
1. 비밀키 3종 설정(`APP_ENCRYPTION_KEY`, `APP_HMAC_KEY`, `APP_SESSION_PEPPER`), `SITE_URL`, `NTS_API_KEY`(발급 후).
2. HTTPS 필수(쿠키 Secure). 리버스 프록시가 `x-forwarded-for`/`cf-connecting-ip`를 신뢰 가능하게 설정.
3. DB 백업: SQLite 파일은 `sqlite3 data/prod.sqlite ".backup backup.sqlite"` 후 별도 저장, 복구는 파일 교체 후 `npm run db:migrate`. 복구 테스트 필요.
## Cloudflare(Pages/Workers + D1) 이식 시 필요 작업 — **미수행/미검증**
- `src/server/db.ts`의 `createD1Db(env.DB)` 어댑터 연결, `migrations/*.sql`을 `wrangler d1 migrations`로 적용.
- `node:fs` 사용부 교체: PDF 한글 폰트 로딩(`src/export/pdf.ts`)을 R2/에셋으로, dev 키 파일(`crypto.ts`)은 운영에서 미사용.
- bcryptjs는 Workers CPU 한도에 맞춰 `BCRYPT_COST` 조정 또는 Argon2(WASM) 검토. exceljs의 Workers 호환성 확인 필요.
- Cloudflare 무료 한도/요금은 배포 시점 공식 문서로 확인(OPEN_ISSUES #3).
