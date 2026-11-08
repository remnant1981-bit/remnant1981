-- K-Startup(공공데이터포털 15125364) 어댑터 구현: 인증키(DATA_GO_KR_API_KEY) 설정 후 수집 가능
UPDATE data_sources SET integration_status='pending_key', source_type='api',
  quota_note='어댑터 구현됨. 공공데이터포털 활용신청 후 DATA_GO_KR_API_KEY 설정 시 수집. 무료·이용허락범위 제한 없음(포털 표기).'
WHERE id='k-startup' AND integration_status='not_integrated';
