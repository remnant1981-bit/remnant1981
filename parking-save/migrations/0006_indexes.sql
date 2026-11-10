-- 조회·갱신 경로 인덱스. 없으면 시설마다 fee_rules/operating_schedules 전체를 훑어 검색·수집이 시설 수에 비례해 느려진다.
CREATE INDEX IF NOT EXISTS idx_fee_lot ON fee_rules (parking_lot_id);
CREATE INDEX IF NOT EXISTS idx_sched_lot ON operating_schedules (parking_lot_id);
CREATE INDEX IF NOT EXISTS idx_dup_b ON duplicate_candidates (lot_b_id);
CREATE INDEX IF NOT EXISTS idx_dup_status ON duplicate_candidates (status);
CREATE INDEX IF NOT EXISTS idx_lots_status ON parking_lots (data_status);
CREATE INDEX IF NOT EXISTS idx_sync_source ON source_sync_logs (source_name, status, started_at);
