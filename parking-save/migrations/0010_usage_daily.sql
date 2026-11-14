-- 운영 현황용 일별 합계(KST 날짜·지표별 건수). IP·좌표·검색어 등 개인을 알 수 있는 값은 저장하지 않는다. 400일 보관.
CREATE TABLE usage_daily (
  ymd TEXT NOT NULL,     -- KST 'YYYY-MM-DD'
  metric TEXT NOT NULL,  -- search_page | search_api | lot_view | report | error | rate_limited | search_cache_hit
  n INTEGER NOT NULL CHECK (n >= 0),
  PRIMARY KEY (ymd, metric)
);
