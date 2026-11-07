-- 공휴일 데이터가 "완전하다"고 보장되는 기간. 이 밖의 기간은 공휴일 판정 불가(요일별 규칙 적용 금지).
CREATE TABLE holiday_coverage (
  source_name TEXT PRIMARY KEY,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  collected_at TEXT NOT NULL
);
