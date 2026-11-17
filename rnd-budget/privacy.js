// 개인정보 처리 안내: 운영 설정(config.js)에 맞춰 통계·광고·문의 문구 표시
(function () {
  'use strict';
  const C = window.RB_CONFIG || {}, $ = (id) => document.getElementById(id);
  if (C.analytics && /^G-[A-Z0-9]{4,}$/.test(C.analytics.ga4 || '')) {
    $('pGa').textContent = '방문 수와 기능 사용 횟수(예: 엑셀 다운로드 횟수)를 파악하기 위해 구글 애널리틱스를 사용합니다. 구글이 쿠키와 접속 정보(브라우저·기기 종류, 대략적인 지역 등)를 수집·처리할 수 있습니다. 입력한 금액·기관명·과제명·검색어는 통계로 보내지 않습니다. 브라우저의 쿠키 차단 또는 구글의 수집 거부 부가 기능으로 거부할 수 있습니다.';
  }
  if (C.adsenseClient) {
    $('pAd').textContent = '구글 애드센스 광고를 게재합니다. 구글과 제휴사가 쿠키를 사용해 이용자의 방문 기록에 기반한 광고를 보여 줄 수 있으며, 구글 광고 설정에서 맞춤 광고를 끌 수 있습니다.';
  }
  if (C.contact) $('pContact').textContent = `문의: ${C.contact}`;
})();
