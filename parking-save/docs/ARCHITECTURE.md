# 시스템 아키텍처

## 제안 구조
- Frontend: 모바일 우선 웹 UI
- Backend: 서비스 API 및 검색/요금 계산 도메인
- Data ingestion: 공공데이터 및 지자체 데이터 수집 작업
- Database: 관계형 DB(PostgreSQL 권장), 공간 검색이 필요하면 PostGIS 검토
- Cache: 자주 조회되는 검색 결과 및 외부 API 응답 캐시
- Scheduler: 데이터 원천별 갱신 주기에 맞춘 동기화 작업

## 데이터 흐름
외부 원천 → 수집 어댑터 → 원천 응답 저장 → 정규화/검증 → 통합 DB → 서비스 API → 웹 UI

## 설계 원칙
- 원천별 어댑터를 분리해 API 변경이 도메인 로직에 전파되지 않게 한다.
- 원천 데이터와 정규화 데이터를 구분한다.
- 동일 시설 후보는 주소·좌표·관리기관·시설명 등을 이용해 중복 검토한다. 자동 병합이 불확실하면 별도 레코드로 보존한다.
- 데이터 신뢰도와 갱신 상태를 필드로 관리한다.
- 외부 API 실패가 검색 전체 실패로 이어지지 않도록 한다.
- 지도 표시와 길찾기 실행은 지도 제공자의 정책·기술 조건을 확인한 후 구현한다.

## 권장 모듈
`parking-source-adapters`, `parking-normalizer`, `parking-search`, `parking-fee-engine`, `recommendation`, `map-link`, `admin-data-quality`.
