/**
 * 메종도로시 공개용 스크립트 — 손님 페이지의 주문 접수 + 상품표·설정 제공
 * (관리자 화면은 admin/ 폴더의 별도 스크립트. 이 스크립트는 "모든 사용자"에게 열려 있으므로 관리 기능을 넣지 않음)
 *
 * 설정 방법 (구글 계정 하나로 1회)
 * 1. 구글 시트 새로 만들기 → 이름 "메종도로시 운영"
 * 2. 메뉴 확장 프로그램 → Apps Script → 이 파일 내용 전체 붙여넣기 → 저장
 * 3. 아래 NOTIFY_EMAIL 에 주문 알림 받을 메일 주소 입력 (비우면 시트 주인에게 보냄)
 * 4. 시트를 새로고침 → 위쪽 메뉴 "메종도로시 → 시트 준비하기" (주문·상품·설정 탭 생성)
 *    지금 상품 11개를 넣으려면 products-sheet.csv 를 "상품" 탭에 가져오기(현재 시트 바꾸기)
 * 5. 배포 → 새 배포 → 유형 "웹 앱" / 실행 사용자: 나 / 액세스 권한: 모든 사용자 → 배포 → 권한 허용
 * 6. 나온 웹 앱 URL(https://script.google.com/macros/s/.../exec)을 config.js 의 orderEndpoint 와 productsUrl 에 넣기
 *
 * 밖으로 보여주는 것은 "상품"·"설정" 탭뿐이며, 손님 정보가 있는 "주문" 탭은 보이지 않습니다.
 * 스크립트를 고친 뒤에는 배포 → 배포 관리 → 수정 → 새 버전으로 다시 배포해야 반영됩니다.
 */
const NOTIFY_EMAIL = '';
const SHEET_NAME = '주문';
const PRODUCT_SHEET = '상품';
const SETTING_SHEET = '설정';
const HEADER = ['접수시각', '주문번호', '상태', '받는분', '연락처', '받는방법', '주소', '상품', '상품금액', '택배비', '입금액', '메모', '송장번호', '관리메모'];
const PRODUCT_HEADER = ['노출', '아이디', '분류', '상품명', '가격', '배지', '사진', '추가사진', '컬러', '사이즈', '추천사이즈', '설명', '코디팁', '인스타링크', '함께입기', '품절'];
const SETTING_ROWS = [
  ['항목', '값', '설명'],
  ['공지', '', '페이지 맨 위 띠에 보이는 한 줄 공지 (비우면 숨김)'],
  ['영업시간안내', '10:00–20:00 · 일요일 휴무', '화면에 그대로 보이는 문구'],
  ['영업요일', '월~토', '예) 월~토, 화~일, 월,수,금, 매일'],
  ['오픈', '10:00', '24시간 표기'],
  ['마감', '20:00', '24시간 표기'],
  ['전화', '', '예) 010-1234-5678'],
  ['카톡채널', '', 'https://pf.kakao.com/... 주소'],
  ['밴드', '', 'https://band.us/... 주소'],
  ['입금계좌', '', '예) 농협 123-4567-8901 (예금주 홍길동)']
];

// 손님 페이지가 상품표·설정을 읽어 감 (상품·설정 탭만 공개)
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const p = ss.getSheetByName(PRODUCT_SHEET), s = ss.getSheetByName(SETTING_SHEET);
  return out({
    ok: !!p,
    rows: p ? p.getDataRange().getDisplayValues() : [],
    settings: s ? s.getDataRange().getDisplayValues() : []
  });
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('메종도로시').addItem('시트 준비하기', 'setupSheets').addToUi();
}

// 주문·상품·설정 탭을 만들고 머리줄을 맞춤 (이미 있는 내용은 지우지 않음)
function setupSheets() {
  sheet();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let p = ss.getSheetByName(PRODUCT_SHEET);
  if (!p) p = ss.insertSheet(PRODUCT_SHEET);
  if (p.getLastRow() === 0) {
    p.appendRow(PRODUCT_HEADER);
    p.appendRow(['N', 'p20', '아우터', '예시) 울 롱코트', '89000', 'NEW', '', '', '베이지, 블랙', '', '66~88', '옷 설명', '사장님 코디 팁', '', '', 'N']);
  }
  p.setFrozenRows(1);
  p.getRange(1, 1, 1, PRODUCT_HEADER.length).setFontWeight('bold').setBackground('#efe9e4');
  let s = ss.getSheetByName(SETTING_SHEET);
  if (!s) s = ss.insertSheet(SETTING_SHEET);
  if (s.getLastRow() === 0) s.getRange(1, 1, SETTING_ROWS.length, 3).setValues(SETTING_ROWS);
  s.setFrozenRows(1);
  s.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#efe9e4');
}
// 예전 메뉴 이름 호환
function setupProducts() { setupSheets(); }

// 시트가 값을 수식으로 실행하지 않도록 (=, +, -, @ 로 시작하는 손님 입력 막기)
function cell(v, n) {
  const t = String(v == null ? '' : v).slice(0, n);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.website) return out({ ok: true });          // 스팸 차단용 숨은 칸
    const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 30)
      .map(x => `${clip(x.name, 40)}(${[clip(x.color, 20), clip(x.size, 20)].filter(String).join('/')})×${Number(x.q) || 1}${x.price > 0 ? '' : ' 가격문의'}`).join('\n');
    if (!items || !clip(d.name, 30) || !clip(d.phone, 20)) return out({ ok: false });

    const sh = sheet();
    sh.appendRow([
      new Date(), cell(d.no, 30), '입금대기', cell(d.name, 30), "'" + clip(d.phone, 20),
      d.pickup ? '매장 픽업' : '택배', cell(d.address, 140), cell(items, 2000),
      Number(d.sub) || 0, d.ship == null ? '확인 후 안내' : Number(d.ship) || 0,
      d.all == null ? '확인 후 안내' : Number(d.all) || 0, cell(d.memo, 300), '', ''
    ]);

    const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, `[메종도로시] 새 주문 ${clip(d.no, 30)} · ${clip(d.name, 30)}`, clip(d.text, 3000));
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false });
  }
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  }
  return sh;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
