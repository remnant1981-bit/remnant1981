-- 기업별 요금제(유료화 설계 B단계). 행이 없으면 무료. 기존 테이블 변경 없음
CREATE TABLE subscriptions (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free','pro','team')),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 100),
  trial_ends_at TEXT,          -- 체험 종료일(YYYY-MM-DD, 포함)
  paid_until TEXT,             -- 결제 이용 종료일(YYYY-MM-DD, 포함)
  memo TEXT,                   -- 입금·세금계산서 등 관리 메모(관리자 전용)
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
