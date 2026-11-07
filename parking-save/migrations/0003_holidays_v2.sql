-- 같은 날 공휴일이 겹칠 수 있고(seq), 분류(date_kind)를 보존하도록 holidays 재구성.
CREATE TABLE holidays_new (
  date TEXT NOT NULL,            -- YYYY-MM-DD (KST)
  seq INTEGER NOT NULL DEFAULT 1,
  name TEXT,
  date_kind TEXT,                -- 원천 분류 코드(원문 보존)
  source_name TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY (date, source_name, seq)
);
INSERT INTO holidays_new(date, seq, name, source_name, collected_at) SELECT date, 1, name, source_name, collected_at FROM holidays;
DROP TABLE holidays;
ALTER TABLE holidays_new RENAME TO holidays;
