/* 메종도로시 주문 페이지 설정 — 매장 정보·상품은 이 파일만 고치면 됩니다.
 * 상품 설명·코디 팁·추천 사이즈는 인스타 게시물 원문에서 가져왔습니다.
 * price 를 비워두면(null) "가격 문의"로 보이고, 손님이 담으면 사장님이 확인 후 입금액을 안내합니다.
 * preview: true 동안은 "오픈 준비 중" 띠가 보이고 주문이 실제로 접수되지 않습니다. */
window.DOROTHY = {
  preview: true,

  store: {
    name: '메종도로시',
    tagline: '좋은 옷, 오래 입는 옷, 매일 손이 가는 옷',
    intro: '66~99 사이즈까지, 입어보면 더 마음에 드는 옷을 고릅니다.',
    sizes: ['66', '77', '88', '99'],
    address: '충남 홍성군 홍북읍 청사로 146 센텀시티 128호',
    landmark: '내포동물병원과 안골빵집 사이 골목',
    hours: '10:00–20:00 · 일요일 휴무',
    phone: '',                       // 예: '010-1234-5678' (비우면 전화 버튼 숨김)
    instagram: 'https://www.instagram.com/2026.do.rothy/',
    dmUrl: 'https://ig.me/m/2026.do.rothy',   // 인스타 DM 바로가기
    kakaoUrl: '',                    // 카톡채널 주소 예: 'https://pf.kakao.com/_xxxxx' (있으면 DM 대신 우선 사용)
    bandUrl: '',                     // 네이버 밴드 주소 (비우면 숨김)
    mapUrl: 'https://map.naver.com/p/search/' + encodeURIComponent('홍성군 홍북읍 청사로 146 센텀시티'),
    bank: '○○은행 000-000-000000 (예금주 ○○○)',
    business: '상호 메종도로시 · 대표 ○○○ · 사업자등록번호 000-00-00000 · 통신판매업 신고 제0000-충남홍성-0000호'
  },

  /* 손님 후기·매장 이야기 (인스타 원문) */
  story: {
    quote: '“메종도로시는 개미지옥이에요!”',
    by: '단골 손님이 붙여준 별명',
    text: '“올 때마다 예쁜 옷 가져오시면 어쩌라는 거예요~” 하시면서도 예쁜 옷 쏙쏙 데려가시는 손님들 덕분에 오늘도 열심히 고르고 있어요. 유행보다 오래 입을 수 있는 옷, 입어보면 더 마음에 드는 옷으로요.',
    photo: 'market.jpg',
    photoAlt: '내포모터페스티벌 프리마켓에 나온 메종도로시 부스'
  },

  /* 이번 주 사장님 픽 (상품 id) */
  pick: 'p06',

  /* 함께 입는 코디 — 사진 한 장에 같이 입은 옷들 */
  looks: [
    { title: '주말 커피 코디', img: 'check-shirt-denim.jpg', items: ['p01', 'p02'], note: '울 체크남방에 소세지 청바지, 소매 한 번 접고 스니커즈' },
    { title: '원피스에 조끼 한 장', img: 'dress-quilted-vest.jpg', items: ['p04', 'p05'], note: '올리브 원피스 위에 네이비 퀼팅 조끼, 가방과 부츠는 브라운' },
    { title: '꽃무늬 나들이룩', img: 'flower-fleece-jacket.jpg', items: ['p08'], note: '꽃 양털 자켓에 크림색 바지, 빈티지한 나들이룩' }
  ],

  shipping: { fee: 3500, freeOver: 70000 },

  /* 주문 접수 주소: 구글 Apps Script 웹앱 URL (order-apps-script.gs 안내 참고).
   * 비워두면 손님이 주문 내용을 복사해 DM·카톡으로 보내는 방식으로 동작합니다. */
  orderEndpoint: '',

  categories: ['아우터', '조끼', '원피스', '상의', '하의'],

  /* 상품 — 위에 있을수록 먼저 보입니다.
   * price: 숫자 또는 null(가격 문의)   img: images 폴더 사진   colors: 고를 컬러(없으면 생략)
   * sizes: 정해진 사이즈(S·M·L 등)   fit: [최소, 최대] 추천 사이즈(없으면 사이즈 상담)
   * tip: 사장님 코디 한마디   post: 인스타 게시물 주소   pair: 함께 입으면 좋은 상품 id   soldOut: true 면 품절 */
  products: [
    { id: 'p06', cat: '하의', name: '기모 스판 데님', price: null, badge: '사장님 추천', img: 'fleece-denim.jpg',
      colors: [], sizes: ['S', 'M', 'L'],
      desc: '스판력이 좋아 앉았다 일어날 때도 편하고, 안쪽은 포근한 기모라 한겨울까지 입어요. 은은한 워싱에 밑단까지 자연스럽게 퍼지는 라인.',
      tip: '매장에서 입어보고 앉아도 보세요. 편안함은 그때 바로 느껴지실 거예요.',
      post: 'https://www.instagram.com/p/Dfoa23gRqvn/' },
    { id: 'p01', cat: '상의', name: '울 체크남방', price: null, badge: 'NEW', img: 'check-shirt.jpg', gallery: ['check-shirt-denim.jpg'],
      colors: [], pair: ['p02'],
      desc: '보송한 울 체크남방. 차분한 브라운 체크에 짙은 데님을 더하면 편하게 입어도 멋이 나요.',
      tip: '저라면 소매를 한 번 접고 스니커즈를 신을래요. 주말에 커피 한잔하러 나갈 때 딱 좋은 코디예요.',
      post: 'https://www.instagram.com/p/DfrSS26RkXT/' },
    { id: 'p02', cat: '하의', name: '소세지 청바지', price: null, badge: 'NEW', img: 'sausage-denim.jpg', gallery: ['check-shirt-denim.jpg'],
      colors: [], pair: ['p01'],
      desc: '밑단이 동글하게 모이는 소세지 핏. 체크남방이나 니트와 귀엽게 어울려요.',
      tip: '청바지 핏이 궁금하시면 매장에서 편하게 입어보세요.',
      post: 'https://www.instagram.com/p/DfrSS26RkXT/' },
    { id: 'p03', cat: '조끼', name: '곡선누빔 양털안감 조끼', price: null, badge: 'NEW', img: 'curved-quilt-vest.jpg',
      colors: [],
      desc: '겉은 깔끔한 곡선 누빔, 안쪽은 보송한 양털 안감. 몸통은 포근하고 팔은 움직이기 편해요.',
      tip: '누빔 패딩바지랑 세트처럼 맞춰보세요. 위아래 톤만 맞춰도 겨울 외출룩이 완성돼요.',
      post: 'https://www.instagram.com/p/DfqdegBIkeo/' },
    { id: 'p04', cat: '원피스', name: '꽃패치 골덴 원피스', price: null, img: 'corduroy-dress.jpg', gallery: ['dress-quilted-vest.jpg'],
      colors: ['차콜', '올리브'], fit: [66, 88], pair: ['p05'],
      desc: '단정한 셔츠카라에 자연스럽게 퍼지는 스커트, 뒤돌면 살짝 보이는 꽃패치. 배와 힙을 편하게 감싸고 양옆 포켓도 있어요.',
      tip: '앵클부츠에 조끼나 가디건 하나 더해보세요. 따뜻한 나들이룩 완성이에요.',
      post: 'https://www.instagram.com/p/DflchE6mfgJ/' },
    { id: 'p05', cat: '조끼', name: '숏 퀼팅 조끼', price: null, img: 'dress-quilted-vest.jpg',
      colors: ['네이비'], pair: ['p04'],
      desc: '짧은 기장의 퀼팅 조끼. 원피스 위에 얹으면 원피스 색은 살리고 코디는 차분하게 잡아줘요.',
      tip: '올리브 원피스에 네이비 퀼팅 조끼, 가방과 부츠는 브라운으로 맞춰봤어요.',
      post: 'https://www.instagram.com/p/Dfq69JyxNdq/' },
    { id: 'p07', cat: '아우터', name: '숲빛 체크 자켓', price: null, img: 'forest-check-jacket.jpg',
      colors: [],
      desc: '딥그린과 차콜이 섞인 체크라 색감은 차분하고, 가까이 보면 보송한 원단 결이 매력적이에요. 큼직한 카라와 포켓.',
      tip: '청바지엔 편하게, 차콜 슬랙스엔 단정하게. 바지는 그대로 두고 아우터만 바꿔보세요.',
      post: 'https://www.instagram.com/p/Dfn9-xmGXTH/' },
    { id: 'p08', cat: '아우터', name: '꽃 양털 자켓', price: null, img: 'flower-fleece-jacket.jpg',
      colors: [], fit: [66, 88],
      desc: '잔꽃무늬에 카키 소매, 소매를 접으면 크림색 보아가 보여요. 뒤는 카키·차콜 배색에 잔잔한 누빔.',
      tip: '크림색 바지랑 입으면 빈티지한 나들이룩, 청바지 위에 걸치면 꽃무늬가 포인트가 돼요.',
      post: 'https://www.instagram.com/p/DfmBp34R6YZ/' },
    { id: 'p09', cat: '아우터', name: '니트 후드 가디건', price: null, img: 'knit-hood-cardigan.jpg',
      colors: ['아이보리', '그레이'], fit: [66, 99],
      desc: '힙을 덮는 하프기장. 겨울 패턴에 떡볶이 단추, 후드 덕분에 뒷모습까지 경쾌해요.',
      tip: '평소 입는 청바지 위에 툭. 기본 티에 하나만 걸쳐도 코디가 살아나요.',
      post: 'https://www.instagram.com/p/Dfjef4rRW0B/' },
    { id: 'p10', cat: '조끼', name: '덤블 빈티지 토글 조끼', price: null, img: 'tumble-toggle-vest.jpg',
      colors: [], fit: [66, 99],
      desc: '보글보글한 덤블에 빈티지한 패턴, 나무 토글 단추. 엉덩이를 덮는 길이라 뒷모습도 편안해요.',
      tip: '평소 즐겨 입는 후드티 입고 오셔서 같이 코디해 봐요.',
      post: 'https://www.instagram.com/p/DfjVM1bR6FN/' },
    { id: 'p11', cat: '아우터', name: '꽃무늬 할매 가디건', price: null, img: 'flower-knit-cardigan.jpg',
      colors: ['네이비', '그레이', '아이보리'], fit: [66, 99],
      desc: '복슬복슬한 니트에 분홍 꽃이 콕콕. 어깨부터 소매까지 여유 있는 오버핏이에요.',
      tip: '청바지에 툭 걸치면 데일리룩, 롱스커트에 단추를 채우면 빈티지한 나들이룩.',
      post: 'https://www.instagram.com/p/DfgTAZzmQ-S/' }
  ]
};
