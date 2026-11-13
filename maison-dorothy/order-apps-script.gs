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
 */
const NOTIFY_EMAIL = '';
const SHEET_NAME = '주문';
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
