-- 관리자가 수정한 공고는 수집기가 덮어쓰지 않도록 잠금
ALTER TABLE announcements ADD COLUMN admin_locked INTEGER NOT NULL DEFAULT 0;
