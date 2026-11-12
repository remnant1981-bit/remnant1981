-- 실시간 잔여면수의 시간대별 집계(혼잡 경향용). 원 스냅샷은 2일만 보관하므로 KST 날짜·시 단위 합계만 56일 보관.
-- 비율 = 잔여면수 / 전체면수(관측 시점). 개인정보 없음.
CREATE TABLE occupancy_hourly (
  parking_lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  ymd TEXT NOT NULL,                                   -- KST 'YYYY-MM-DD'
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23), -- KST 시
  ratio_sum REAL NOT NULL,
  samples INTEGER NOT NULL CHECK (samples > 0),
  PRIMARY KEY (parking_lot_id, ymd, hour)
);
CREATE INDEX idx_occ_hourly_ymd ON occupancy_hourly (ymd);
