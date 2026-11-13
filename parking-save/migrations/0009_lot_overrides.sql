-- 관리자 수동 보정(요금·운영시간). 보정 값은 fee_rules/operating_schedules에 직접 써 넣고(검색·상세·지역 목록이 같은 값을 읽음),
-- 이 표에는 보정 내용·원천 값 스냅샷·이력을 남긴다. 수집이 해당 시설을 다시 쓰면 스냅샷을 갱신하고 보정을 다시 적용한다.
CREATE TABLE lot_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('FEE','HOURS')),
  payload_json TEXT NOT NULL,           -- 보정 입력(검증된 형태)
  source_snapshot_json TEXT NOT NULL,   -- 보정 전(원천) 행들 — 되돌릴 때 복원
  note TEXT,
  report_id INTEGER REFERENCES lot_reports(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVERTED','SUPERSEDED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_by TEXT,
  ended_at TEXT
);
-- 시설·종류별 적용 중인 보정은 하나
CREATE UNIQUE INDEX idx_overrides_active ON lot_overrides (parking_lot_id, kind) WHERE status = 'ACTIVE';
CREATE INDEX idx_overrides_lot ON lot_overrides (parking_lot_id, created_at);
