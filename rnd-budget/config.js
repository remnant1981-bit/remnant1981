// 운영 설정(공개 정보만). 비밀번호·키를 넣지 말 것.
window.RB_CONFIG = {
  // 구글 애드센스(승인 후 입력). 비우면 광고 영역이 표시되지 않음
  adsenseClient: '',        // 예: 'ca-pub-0000000000000000'
  adsenseSlots: { top: '', bottom: '' },
  // 기능 스위치(단계적 공개). false = 화면에서 숨김(코드·데이터는 유지). 켜려면 true 로 바꿔 배포
  features: {
    examples: true,     // 예시로 체험하기
    project: false,     // 연차별·공동기관별 편성(과제 구성·편집 탭·총괄표) — 2단계 공개 예정
    scenarios: false,   // 여러 안 저장·불러오기
    faq: false,         // 자주 묻는 질문
    steps: false,       // 상단 단계 메뉴
    legalHeader: false, // 상단 적용 법령 문구(하단 안내에는 항상 표시)
    execution: true,    // 집행 현황판(편성/집행 전환, 월별 집행·점검·일정·백업) — 2026-11-14 공개
  },
  // 문의 연락처(비우면 표시 안 함)
  contact: '',
};
