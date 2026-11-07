-- GovBiz Finder 초기 스키마 (SQLite / Cloudflare D1 호환). 시각은 UTC ISO-8601 문자열.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- 토큰의 해시(평문 토큰은 쿠키에만 존재)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  business_number_ciphertext TEXT,
  business_number_lookup_hash TEXT,
  business_number_masked TEXT,
  company_name TEXT,
  representative_name TEXT,
  region_sido TEXT,
  region_sigungu TEXT,
  industry_name TEXT,
  established_at TEXT,
  revenue_band TEXT,
  employee_count_band TEXT,
  research_institute_status TEXT CHECK (research_institute_status IN ('yes','no') OR research_institute_status IS NULL),
  venture_status TEXT CHECK (venture_status IN ('yes','no') OR venture_status IS NULL),
  export_status TEXT CHECK (export_status IN ('yes','no') OR export_status IS NULL),
  tech_keywords TEXT,
  business_status TEXT,          -- 국세청 상태조회 결과(계속사업자 등)
  tax_type TEXT,
  profile_source TEXT,           -- 'user_input' | 'nts_status' | 'nts_status_mock'
  profile_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_companies_lookup ON companies(business_number_lookup_hash);

CREATE TABLE company_members (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','rejected')),
  verification_method TEXT,
  verified_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, user_id)
);
CREATE INDEX idx_members_user ON company_members(user_id, company_id, verification_status);

CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,     -- 'api' | 'rss' | 'web' | 'manual' | 'mock'
  base_url TEXT,
  terms_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  collection_frequency TEXT,
  quota_note TEXT,
  integration_status TEXT NOT NULL DEFAULT 'not_integrated', -- 'not_integrated' | 'mock' | 'manual' | 'live'
  last_success_at TEXT,
  last_error TEXT,
  next_run_at TEXT
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  source_notice_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  organization TEXT NOT NULL,
  category TEXT,                 -- 대표 분야 코드
  region_scope TEXT NOT NULL DEFAULT '전국',   -- '전국' | 시/도 | '시/도 시/군/구'
  target_summary TEXT,
  support_summary TEXT,
  support_amount_min INTEGER,
  support_amount_max INTEGER,
  support_amount_text TEXT,
  application_start TEXT,        -- YYYY-MM-DD (Asia/Seoul 기준 날짜)
  application_end TEXT,
  application_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (application_status IN ('upcoming','open','closed','always','unknown')),
  status_basis TEXT NOT NULL DEFAULT 'estimated' CHECK (status_basis IN ('confirmed','estimated')),
  eligibility_text TEXT,
  required_documents TEXT,
  application_method TEXT,
  contact_info TEXT,
  original_text TEXT,
  first_collected_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source_id, source_notice_id)
);
CREATE INDEX idx_ann_status_end ON announcements(application_status, application_end);
CREATE INDEX idx_ann_cat_region ON announcements(category, region_scope);
CREATE INDEX idx_ann_hash ON announcements(content_hash);
CREATE INDEX idx_ann_url ON announcements(canonical_url);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE announcement_categories (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  PRIMARY KEY (announcement_id, category_id)
);

CREATE TABLE announcement_files (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  collected_at TEXT NOT NULL
);

CREATE TABLE announcement_revisions (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL,
  changed_by TEXT,               -- 'collector:<source>' | 'admin:<user_id>'
  change_summary TEXT,
  old_content_hash TEXT,
  new_content_hash TEXT
);

CREATE TABLE eligibility_rules (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL DEFAULT 'required',
  field_key TEXT NOT NULL,
  operator TEXT NOT NULL,
  expected_value TEXT NOT NULL,  -- JSON
  source_excerpt TEXT,
  confidence REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX idx_rules_ann ON eligibility_rules(announcement_id);

CREATE TABLE company_matches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  result_status TEXT NOT NULL,
  score INTEGER,
  reasons_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE (company_id, announcement_id)
);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, company_id, announcement_id)
);
CREATE INDEX idx_bookmarks_user ON bookmarks(user_id, company_id);

CREATE TABLE search_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  query_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_search_hist_user ON search_history(user_id, created_at);

CREATE TABLE view_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL
);
CREATE INDEX idx_view_hist_user ON view_history(user_id, viewed_at);

CREATE TABLE notification_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('new_announcement','deadline_soon','bookmark_changed')),
  enabled INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email')),
  deadline_days INTEGER NOT NULL DEFAULT 3,
  PRIMARY KEY (user_id, company_id, type)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','failed','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (user_id, company_id, dedupe_key)
);
CREATE INDEX idx_notif_user ON notifications(user_id, company_id, status);

CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);
CREATE INDEX idx_runs_source ON collection_runs(source_id, started_at);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  created_at TEXT NOT NULL,
  metadata_redacted_json TEXT
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- 중복 병합 시 모든 원천 출처·원본 링크 보존
CREATE TABLE announcement_sources (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  source_notice_id TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, source_id, source_notice_id)
);
