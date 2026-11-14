-- 공고문 자격요건 AI 추출 결과(설계: docs/AI_EXTRACTION_DESIGN.md). 기존 테이블 변경 없음.
-- 원문(content_hash)·프롬프트 버전이 같으면 다시 추출하지 않는다(캐시).
CREATE TABLE ai_extractions (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  version TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','ok','failed')),
  batch_id TEXT,
  output_json TEXT,          -- 모델 출력 원본(검증 전, 감사용)
  rules_json TEXT,           -- 검증 후 매칭 규칙
  dropped_json TEXT,         -- 검증에서 버린 항목·사유
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, content_hash, version)
);
CREATE INDEX idx_ai_ext_status ON ai_extractions(status, batch_id);
CREATE INDEX idx_ai_ext_updated ON ai_extractions(updated_at);
