// 운영 설정(공개 정보만). 비밀키는 절대 넣지 말 것 — 이용권 서명 개인키는 운영자 PC에만 보관.
window.RB_CONFIG = {
  // Pro 이용권 검증용 공개키(JWK). `node scripts/rnd-budget-license.mjs keygen` 출력값을 붙여 넣음. null 이면 Pro 판매 준비 중 표시
  licensePublicKey: null,
  // Pro 이용권 판매 페이지(스마트스토어·크몽·Gumroad 등). 비우면 구매 버튼 비활성
  storeUrl: '',
  // 판매가 안내 문구
  priceText: '1년 이용권 9,900원(부가세 포함)',
  // 문의 연락처(비우면 표시 안 함)
  contact: '',
  // 구글 애드센스(승인 후 입력). 비우면 광고 영역 숨김
  adsenseClient: '',
  adsenseSlot: '',
};
