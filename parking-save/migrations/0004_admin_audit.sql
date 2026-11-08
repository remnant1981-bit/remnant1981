-- 관리자 API 감사로그 (SECURITY_PRIVACY.md: 관리자 수집 API는 인증·인가 및 감사로그). 비밀값·원본 IP는 저장하지 않는다.
CREATE TABLE admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,          -- 예: sync:holidays
  outcome TEXT NOT NULL,         -- OK | DENIED | FAILED | REJECTED
  client_hash TEXT,              -- 클라이언트 IP의 솔트 해시 앞 16자리(원본 IP 미저장)
  detail TEXT                    -- 짧은 사유 코드
);
CREATE INDEX idx_audit_at ON admin_audit_logs (at);
