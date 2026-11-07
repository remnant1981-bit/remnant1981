-- ParkingSave 초기 스키마 (docs/DATABASE.md + OPEN_ISSUES D1~D4 반영안).
-- 원칙: 값이 없으면 NULL. 0/무료로 치환하지 않음. 시각은 UTC ISO8601(Z), 표시는 Asia/Seoul.

-- D3: 원천 응답 원문 보존 (원천 값과 정규화 값 분리)
CREATE TABLE source_raw_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source_updated_at TEXT,
  collected_at TEXT NOT NULL,
  UNIQUE (source_name, source_record_id, payload_hash)
);

CREATE TABLE parking_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  name TEXT NOT NULL,
  operator_name TEXT,
  parking_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (parking_type IN ('ON_STREET','OFF_STREET','UNKNOWN')),
  ownership_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (ownership_type IN ('PUBLIC','UNKNOWN')),
  address TEXT,
  road_address TEXT,
  latitude REAL,
  longitude REAL,
  total_spaces INTEGER CHECK (total_spaces IS NULL OR total_spaces >= 0),
  phone TEXT,
  source_url TEXT,
  source_updated_at TEXT,
  collected_at TEXT NOT NULL,
  data_status TEXT NOT NULL DEFAULT 'ACTIVE',
  quality_flags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_record_id INTEGER REFERENCES source_raw_records(id),
  UNIQUE (source_name, source_record_id)
);
CREATE INDEX idx_lots_geo ON parking_lots (latitude, longitude);

-- D2: 일일최대 기준·회차 등 표현 필드 추가. amount NULL = 금액 미확인(0원 아님)
CREATE TABLE fee_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('BASE','ADDITIONAL','DAILY_MAX','FREE','SEASON_PASS','OTHER')),
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  valid_day_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (valid_day_type IN ('WEEKDAY','SATURDAY','SUNDAY','HOLIDAY','EVERYDAY','UNKNOWN')),
  start_time TEXT,            -- 'HH:MM' (KST), NULL = 종일
  end_time TEXT,              -- 'HH:MM', '24:00' 허용
  effective_from TEXT,
  effective_to TEXT,
  daily_max_basis TEXT CHECK (daily_max_basis IS NULL OR daily_max_basis IN ('CALENDAR_DAY','ENTRY_24H','UNKNOWN')),
  free_flag INTEGER CHECK (free_flag IS NULL OR free_flag IN (0,1)),
  source_record_id TEXT,
  verified_at TEXT
);

CREATE TABLE operating_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  day_type TEXT NOT NULL CHECK (day_type IN ('WEEKDAY','SATURDAY','SUNDAY','HOLIDAY','EVERYDAY','UNKNOWN')),
  open_time TEXT,
  close_time TEXT,
  all_day_flag INTEGER CHECK (all_day_flag IS NULL OR all_day_flag IN (0,1)),
  closed_flag INTEGER CHECK (closed_flag IS NULL OR closed_flag IN (0,1)),
  holiday_policy TEXT,
  source_record_id TEXT,
  verified_at TEXT
);

CREATE TABLE occupancy_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  total_spaces INTEGER,
  available_spaces INTEGER,
  occupied_spaces INTEGER,
  observed_at TEXT,           -- NULL이면 현재 정보로 표시 금지
  collected_at TEXT NOT NULL,
  source_name TEXT NOT NULL,
  validity_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
);
CREATE INDEX idx_occ_lot ON occupancy_snapshots (parking_lot_id, collected_at);

CREATE TABLE source_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  records_received INTEGER,
  records_inserted INTEGER,
  records_updated INTEGER,
  error_summary TEXT,
  source_data_timestamp TEXT
);

-- D1: 공휴일 (원천 미정 — OPEN_ISSUES #4). 데이터가 없으면 요금엔진은 계산 불가 반환
CREATE TABLE holidays (
  date TEXT PRIMARY KEY,      -- YYYY-MM-DD (KST)
  name TEXT,
  source_name TEXT NOT NULL,
  collected_at TEXT NOT NULL
);

-- D4: 중복 후보. 자동 병합이 불확실하면 별도 레코드로 보존하고 후보만 기록
CREATE TABLE duplicate_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_a_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  lot_b_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  score REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','MERGED','REJECTED')),
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (lot_a_id < lot_b_id),
  UNIQUE (lot_a_id, lot_b_id)
);
