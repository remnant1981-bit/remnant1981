# 시스템 아키텍처

## 1. 기본 구성
- Web UI: Next.js + TypeScript + Tailwind CSS
- Server/API: Next.js 서버 기능 또는 Cloudflare Workers
- DB: Cloudflare D1(SQL)
- 파일 저장: 필요 시 Cloudflare R2
- 배포: Cloudflare Pages/Workers
- 외부 연계: 국세청 사업자등록정보 API, 공고 원천기관 API/공개 페이지

저장소와 배포 환경이 이미 정해져 있다면 기존 구조를 우선 존중한다. 기술 변경은 호환성·비용·운영 난이도를 비교한 후 결정한다.

## 2. 논리 구성
1. Presentation: 화면·폼·검색 결과
2. API/Application: 인증, 권한, 검색, 기업 추천, 내보내기
3. Domain: 공고, 기업, 자격 규칙, 추천 로직
4. Infrastructure: D1, 외부 API, 파일 저장, 수집기, 이메일

## 3. 데이터 흐름
- 수집기 → 원천별 어댑터 → 정규화/검증 → 중복 판정 → announcements 저장
- 사용자 검색 → 검색 API → 공개 공고 조회 → 필터/정렬/페이지네이션
- 기업 추천 → 인증된 기업 프로필 조회 → 규칙 기반 자격 평가 → 근거와 상태 반환
- 내보내기 → 현재 검색 조건 및 권한 확인 → 파일 생성

## 4. 환경 분리
- local/development
- test/staging
- production
각 환경의 DB와 비밀키를 분리한다. 운영 데이터로 개발 테스트하지 않는다.

## 5. 비용 원칙
- 초기 무료/저비용 플랜을 우선 검토하되 무료 한도와 제한은 배포 시점에 공식 문서로 확인한다.
- 외부 API·도메인·이메일·스토리지·AI 사용량은 별도 비용이 발생할 수 있다.
- Claude Code 구독과 Anthropic API 사용량 과금은 별개로 취급한다.
- Google Sheets를 운영 DB로 사용하지 않는다.
