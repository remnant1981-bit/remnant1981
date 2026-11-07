# 데이터베이스 설계

실제 DDL은 선택한 DB 런타임에 맞춰 작성한다. 모든 테이블에 생성·수정 시각을 일관되게 적용한다.

## 1. 핵심 테이블
### users
- id (UUID/ULID)
- email 또는 로그인 식별자(초기 인증 설계에 맞게)
- password_hash
- status
- created_at, updated_at, last_login_at

### companies
- id
- business_number_ciphertext
- business_number_lookup_hash (필요한 경우 HMAC 기반)
- company_name
- representative_name
- address/region_code
- industry_code/industry_name
- established_at
- revenue_band
- employee_count_band
- research_institute_status
- venture_status
- export_status
- business_status
- profile_source 및 profile_verified_at
- created_at, updated_at

### company_members
- id
- company_id
- user_id
- role
- verification_status
- verified_at
- created_at
초기에는 기업당 대표 계정 1개 정책으로 제한할 수 있으나 복수 사용자 확장 가능한 구조를 유지한다.

### announcements
- id
- source_id
- source_notice_id
- canonical_url
- title
- organization
- category
- region_scope
- target_summary
- support_summary
- support_amount_min/max 또는 원문 표현
- application_start/end
- application_status
- eligibility_text
- required_documents
- application_method
- contact_info
- original_text 또는 필요한 구조화 텍스트
- first_collected_at, last_checked_at
- published_at, updated_at
- content_hash
- is_active

### announcement_files
- id, announcement_id, name, source_url, mime_type, size_bytes, collected_at

### announcement_categories
- announcement_id, category_id

### eligibility_rules
- id, announcement_id, rule_type, field_key, operator, expected_value, source_excerpt, confidence

### company_matches
- id, company_id, announcement_id, result_status, score, reasons_json, evaluated_at
회사 소속 권한을 검증한 요청에서만 접근 가능.

### bookmarks
- user_id, company_id, announcement_id, created_at

### search_history
- id, user_id, company_id, query_json, created_at

### view_history
- id, user_id, company_id, announcement_id, viewed_at

### notifications
- id, user_id, company_id, type, payload_json, channel, status, scheduled_at, sent_at

### data_sources
- id, name, source_type, base_url, terms_url, enabled, collection_frequency, last_success_at, last_error

### collection_runs
- id, source_id, started_at, finished_at, status, fetched_count, inserted_count, updated_count, skipped_count, error_summary

### admin_audit_logs
- id, admin_user_id, action, target_type, target_id, created_at, metadata_redacted_json

## 2. 인덱스
- announcements(application_status, application_end)
- announcements(category, region_scope)
- announcements(source_id, source_notice_id)
- announcements(content_hash)
- company_members(user_id, company_id, verification_status)
- bookmarks(user_id, company_id)
- search_history(user_id, created_at)
- view_history(user_id, viewed_at)
- companies(business_number_lookup_hash) — 적용 시

## 3. 데이터 무결성
- 공고 원천 ID와 출처 조합의 유일성
- 기업-사용자 관계의 중복 방지
- 외래키 및 삭제 정책 명시
- 기업 프로필 삭제 시 연관 이력 보존/삭제 정책을 개인정보 정책에 맞춰 처리
- 사업자번호는 평문 로그·응답·분석 이벤트에 포함하지 않는다.
