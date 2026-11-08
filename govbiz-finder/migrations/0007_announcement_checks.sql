-- 공고별 조건 직접 확인(원문 확인 결과 해당함/해당 안 함). 해당 공고의 판정에만 반영
CREATE TABLE announcement_checks (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('yes','no')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, announcement_id, field_key)
);
