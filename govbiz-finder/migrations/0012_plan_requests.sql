-- 요금제 신청(유료화 1단계: 셀프 체험 + 계좌이체 신청 → 관리자 입금 확인 후 활성화). 기존 테이블 변경 없음
CREATE TABLE plan_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trial','paid')),
  plan TEXT NOT NULL CHECK (plan IN ('pro','team')),
  cycle TEXT CHECK (cycle IN ('monthly','yearly')),   -- paid 만 사용
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 100),
  amount_supply INTEGER,        -- 공급가액(원), 서버 계산값
  amount_vat INTEGER,           -- 부가세(원)
  amount_total INTEGER,         -- 입금 요청액(원)
  depositor_name TEXT,          -- 입금자명
  invoice_email TEXT,           -- 세금계산서 수신 이메일
  memo TEXT,                    -- 신청자 요청사항
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  admin_memo TEXT,
  processed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_plan_requests_company ON plan_requests(company_id, created_at);
CREATE INDEX idx_plan_requests_status ON plan_requests(status, created_at);
-- 기업당 처리 대기 신청 1건, 셀프 체험 1회
CREATE UNIQUE INDEX uq_plan_requests_pending ON plan_requests(company_id) WHERE kind='paid' AND status='pending';
CREATE UNIQUE INDEX uq_plan_requests_trial ON plan_requests(company_id) WHERE kind='trial';
