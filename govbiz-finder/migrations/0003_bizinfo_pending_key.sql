UPDATE data_sources SET integration_status='pending_key',
  quota_note='어댑터 구현됨. 기업마당 API 인증키(BIZINFO_API_KEY) 발급·설정 후 수집 가능. 재배포·출처표시 범위 확인 필요.'
WHERE id='bizinfo' AND integration_status='not_integrated';
