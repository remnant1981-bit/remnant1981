-- 이용자 정보 오류 신고. 자동 반영하지 않고 관리자가 검토한다(원천 데이터 수정은 별도 절차).
-- 개인정보 최소화: 이름·연락처를 받지 않고, 클라이언트는 솔트 해시 앞 16자리만 저장(도배 확인용).
CREATE TABLE lot_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('FEE','HOURS','LOCATION','CLOSED','OTHER')),
  message TEXT,
  created_at TEXT NOT NULL,
  client_hash TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWED','DISMISSED')),
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX idx_reports_status ON lot_reports (status, created_at);
CREATE INDEX idx_reports_lot ON lot_reports (parking_lot_id);
