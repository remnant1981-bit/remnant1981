-- 신청 진행 관리(기업 단위 공유). 기존 테이블 변경 없음
CREATE TABLE pipeline_items (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('interested','reviewing','preparing','applied','selected','rejected','dropped')),
  assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_date TEXT,                 -- 내부 목표일(YYYY-MM-DD), 공고 마감일과 별개
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, announcement_id)
);
CREATE INDEX idx_pipeline_company_stage ON pipeline_items(company_id, stage);

CREATE TABLE pipeline_notes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id, announcement_id) REFERENCES pipeline_items(company_id, announcement_id) ON DELETE CASCADE
);
CREATE INDEX idx_pipeline_notes_item ON pipeline_notes(company_id, announcement_id, created_at);
