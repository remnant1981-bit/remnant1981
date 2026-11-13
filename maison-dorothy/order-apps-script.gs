/**
 * 메종도로시 주문 접수 — 구글 Apps Script (사장님 구글 계정에서 1회 설정)
 *
 * 설정 방법
 * 1. 구글 시트 새로 만들기 → 이름 "메종도로시 주문"
 * 2. 메뉴 확장 프로그램 → Apps Script → 이 파일 내용 전체 붙여넣기 → 저장
 * 3. 아래 NOTIFY_EMAIL 에 주문 알림 받을 메일 주소 입력 (비우면 시트 주인에게 보냄)
 * 4. 배포 → 새 배포 → 유형 "웹 앱"
 *      실행 사용자: 나 / 액세스 권한: 모든 사용자 → 배포 → 권한 허용
 * 5. 나온 웹 앱 URL(https://script.google.com/macros/s/.../exec)을
 *    config.js 의 orderEndpoint 에 넣기
 *
 * 주문이 들어오면 "주문" 시트에 한 줄씩 쌓이고, 메일 알림이 갑니다.
 * 상태 칸(입금확인/발송완료 등)은 사장님이 직접 고쳐 쓰면 됩니다.
 *
 * 상품 관리 (같은 스크립트·같은 웹앱 URL)
 * 6. 시트를 새로고침하면 위쪽 메뉴에 "메종도로시"가 생김 → "상품표 만들기"
 *    (또는 products-sheet.csv 를 파일 → 가져오기 → "새 시트 삽입"으로 넣고 탭 이름을 "상품"으로)
 * 7. config.js 의 productsUrl 에도 같은 웹앱 URL 입력
 * 8. 이후 "상품" 탭만 고치면 페이지에 반영 (손님 휴대폰에는 다음 방문 또는 새로고침 때)
 *    - 노출: N 이면 숨김 / 품절: Y 면 품절 표시 / 가격: 비우면 "가격 문의"
 *    - 사진: images 폴더 파일명, 또는 구글 드라이브 사진 공유 링크("링크가 있는 모든 사용자" 보기 권한)
 *    - 아이디: 한 번 정하면 바꾸지 마세요 (찜·공유 링크가 아이디로 연결됨)
 * 웹앱이 밖으로 보여주는 것은 "상품" 탭뿐이며, "주문" 탭은 보이지 않습니다.
 * 스크립트를 고친 뒤에는 배포 → 배포 관리 → 수정 → 새 버전으로 다시 배포해야 반영됩니다.
 */
const NOTIFY_EMAIL = '';
const SHEET_NAME = '주문';
const PRODUCT_SHEET = '상품';
const PRODUCT_HEADER = ['노출', '아이디', '분류', '상품명', '가격', '배지', '사진', '추가사진', '컬러', '사이즈', '추천사이즈', '설명', '코디팁', '인스타링크', '함께입기', '품절'];

// 페이지가 상품표를 읽어 감 (상품 탭만 공개)
function doGet(e) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCT_SHEET);
  if (!sh) return out({ ok: false, rows: [] });
  return out({ ok: true, rows: sh.getDataRange().getDisplayValues() });
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('메종도로시').addItem('상품표 만들기', 'setupProducts').addToUi();
}

function setupProducts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PRODUCT_SHEET);
  if (!sh) sh = ss.insertSheet(PRODUCT_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(PRODUCT_HEADER);
    sh.appendRow(['Y', 'p20', '아우터', '예시) 울 롱코트', '89000', 'NEW', '드라이브 사진 공유 링크', '', '베이지, 블랙', '', '66~88', '옷 설명', '사장님 코디 팁', 'https://www.instagram.com/p/...', '', 'N']);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, PRODUCT_HEADER.length).setFontWeight('bold').setBackground('#efe9e4');
}
const HEADER = ['접수시각', '주문번호', '상태', '받는분', '연락처', '받는방법', '주소', '상품', '상품금액', '택배비', '입금액', '메모'];

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
      new Date(), clip(d.no, 30), '입금대기', clip(d.name, 30), "'" + clip(d.phone, 20),
      d.pickup ? '매장 픽업' : '택배', clip(d.address, 120), items,
      Number(d.sub) || 0, d.ship == null ? '확인 후 안내' : Number(d.ship) || 0,
      d.all == null ? '확인 후 안내' : Number(d.all) || 0, clip(d.memo, 300)
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
