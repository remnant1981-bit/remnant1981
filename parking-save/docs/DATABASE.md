# 데이터베이스 설계 초안

## parking_lots
- id (내부 PK)
- source_id, source_record_id
- name, operator_name
- parking_type: `ON_STREET` / `OFF_STREET` / `UNKNOWN`
- ownership_type: `PUBLIC` / `UNKNOWN`
- address, road_address
- latitude, longitude
- total_spaces (nullable)
- phone (nullable)
- source_name, source_url (nullable)
- source_updated_at, collected_at
- data_status, quality_flags
- created_at, updated_at

## fee_rules
- id, parking_lot_id
- rule_type: 기본요금/추가요금/일일최대/정기권 등
- amount, duration_minutes
- valid_day_type: 평일/토요일/일요일/공휴일/매일/미상
- start_time, end_time (nullable)
- effective_from, effective_to (nullable)
- free_flag (nullable)
- source_record_id, verified_at

## operating_schedules
- id, parking_lot_id
- day_type, open_time, close_time
- all_day_flag, closed_flag
- holiday_policy (nullable)
- source_record_id, verified_at

## occupancy_snapshots
- id, parking_lot_id
- total_spaces, available_spaces, occupied_spaces (nullable)
- observed_at, collected_at
- source_name, validity_status

## source_sync_logs
- id, source_name, started_at, finished_at
- status, records_received, records_inserted, records_updated
- error_summary, source_data_timestamp

## 원칙
- 출처가 다른 동일 시설 레코드를 무조건 덮어쓰지 않는다.
- 값이 없으면 NULL로 저장한다. 0 또는 무료로 치환하지 않는다.
- 요금 규칙은 원천별 표현을 보존할 수 있도록 원천 JSON/원문을 별도 보관하는 방안을 구현한다.
- 시간대는 `Asia/Seoul` 기준 표시, 저장 형식은 UTC 또는 명시적 오프셋을 일관되게 적용한다.
