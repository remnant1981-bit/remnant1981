/**
 * 메종도로시 공개용 스크립트 — 손님 페이지의 주문 접수 + 상품표·설정 제공
 * (관리자 화면은 admin/ 폴더의 별도 스크립트. 이 스크립트는 "모든 사용자"에게 열려 있으므로 관리 기능을 넣지 않음)
 *
 * 설정 방법 (구글 계정 하나로 1회)
 * 1. 구글 시트 새로 만들기 → 이름 "메종도로시 운영"
 * 2. 메뉴 확장 프로그램 → Apps Script → 이 파일 내용 전체 붙여넣기 → 저장
 * 3. 아래 NOTIFY_EMAIL 에 주문 알림 받을 메일 주소 입력 (비우면 시트 주인에게 보냄)
 * 4. 시트를 새로고침 → 위쪽 메뉴 "메종도로시 → 시트 준비하기" (현황·주문·상품·설정 탭 생성, 서식 적용, 빈 기본 탭 정리)
 *    상품을 가져오거나 칸을 손본 뒤에는 "메종도로시 → 보기 좋게 꾸미기"를 다시 누르면 서식이 맞춰짐
 *    지금 상품 11개를 넣으려면 products-sheet.csv 를 "상품" 탭에 가져오기(현재 시트 바꾸기)
 * 5. 배포 → 새 배포 → 유형 "웹 앱" / 실행 사용자: 나 / 액세스 권한: 모든 사용자 → 배포 → 권한 허용
 * 6. 나온 웹 앱 URL(https://script.google.com/macros/s/.../exec)을 config.js 의 orderEndpoint 와 productsUrl 에 넣기
 *
 * 7. (선택) 메뉴 "메종도로시 → 자동화 켜기" — 아침 요약 메일·입금기한 알림·주문 보관·주간 백업·고객/인기상품 갱신
 *
 * 밖으로 보여주는 것은 "상품"·"설정" 탭뿐이며, 손님 정보가 있는 "주문" 탭은 보이지 않습니다.
 * 스크립트를 고친 뒤에는 배포 → 배포 관리 → 수정 → 새 버전으로 다시 배포해야 반영됩니다.
 */
const NOTIFY_EMAIL = '';
const SHEET_NAME = '주문';
const PRODUCT_SHEET = '상품';
const SETTING_SHEET = '설정';
const HEADER = ['접수시각', '주문번호', '상태', '받는분', '연락처', '받는방법', '주소', '상품', '상품금액', '택배비', '입금액', '메모', '송장번호', '관리메모', '소식수신'];
const PRODUCT_HEADER = ['노출', '아이디', '분류', '상품명', '가격', '배지', '사진', '추가사진', '컬러', '사이즈', '추천사이즈', '설명', '코디팁', '인스타링크', '함께입기', '품절', '재고'];
// 드롭다운 목록 (분류·배지·추천사이즈는 목록 밖 값도 허용)
const LISTS = {
  상태: ['입금대기', '입금확인', '발송완료', '픽업완료', '취소'], 받는방법: ['택배', '매장 픽업'], YN: ['Y', 'N'],
  분류: ['아우터', '조끼', '원피스', '상의', '니트', '하의', '스커트', '잡화', '기타'],
  배지: ['NEW', '사장님 추천', '재입고', 'BEST'],
  추천사이즈: ['66~77', '66~88', '66~99', '77~88', '77~99', '88~99']
};
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
  ['입금계좌', '', '예) 농협 123-4567-8901 (예금주 홍길동)'],
  ['입금기한', '2', '입금대기 주문을 며칠 지나면 알릴지 (일) — 자동화'],
  ['자동취소', 'N', 'Y 로 바꾸면 입금기한이 지난 주문을 자동 취소 — 자동화'],
  ['보관기간', '90', '완료·취소 주문을 며칠 뒤 "보관" 탭으로 옮길지 (일) — 자동화']
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
  SpreadsheetApp.getUi().createMenu('메종도로시')
    .addItem('시트 준비하기', 'setupSheets')
    .addItem('보기 좋게 꾸미기', 'styleSheets')
    .addSeparator()
    .addItem('자동화 켜기', 'enableAutomation')
    .addItem('자동화 끄기', 'disableAutomation')
    .addItem('지금 아침 요약 받아보기', 'dailyJob')
    .addItem('고객·인기상품 새로 계산', 'buildInsights')
    .addToUi();
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
  ensureHeader_(p, '재고');
  HEADER.forEach(h => ensureHeader_(sheet(), h));
  p.setFrozenRows(1);
  p.getRange(1, 1, 1, PRODUCT_HEADER.length).setFontWeight('bold').setBackground('#efe9e4');
  let s = ss.getSheetByName(SETTING_SHEET);
  if (!s) s = ss.insertSheet(SETTING_SHEET);
  if (s.getLastRow() === 0) s.getRange(1, 1, SETTING_ROWS.length, 3).setValues(SETTING_ROWS);
  ensureSettingRows_(s);
  s.setFrozenRows(1);
  s.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#efe9e4');
  removeEmptyDefaultSheets_(ss);
  styleSheets();
}

// 새 시트를 만들 때 생기는 빈 기본 탭(시트1, Sheet1 …) 정리 — 내용이 한 칸이라도 있으면 그대로 둠
function removeEmptyDefaultSheets_(ss) {
  ss.getSheets().forEach(sh => {
    if (!/^(시트|Sheet)\s*\d+$/i.test(sh.getName())) return;
    if (sh.getLastRow() > 0 || sh.getLastColumn() > 0) return;
    if (ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
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
    // 칸 이름으로 맞춰 넣음 → 칸 순서가 바뀌거나 새 칸(소식수신)이 생겨도 안전
    HEADER.forEach(h => ensureHeader_(sh, h));
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).replace(/\s/g, ''));
    const v = {
      접수시각: new Date(), 주문번호: cell(d.no, 30), 상태: '입금대기', 받는분: cell(d.name, 30), 연락처: "'" + clip(d.phone, 20),
      받는방법: d.pickup ? '매장 픽업' : '택배', 주소: cell(d.address, 140), 상품: cell(items, 2000),
      상품금액: Number(d.sub) || 0, 택배비: d.ship == null ? '확인 후 안내' : Number(d.ship) || 0,
      입금액: d.all == null ? '확인 후 안내' : Number(d.all) || 0, 메모: cell(d.memo, 300), 소식수신: d.ad === true ? 'Y' : 'N'
    };
    sh.appendRow(head.map(h => (h in v ? v[h] : '')));

    const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, `[메종도로시] 새 주문 ${clip(d.no, 30)} · ${clip(d.name, 30)}`, clip(d.text, 3000));
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false });
  }
}

function ensureHeader_(sh, name) {
  const w = sh.getLastColumn();
  const head = w ? sh.getRange(1, 1, 1, w).getDisplayValues()[0].map(h => String(h).replace(/\s/g, '')) : [];
  if (head.indexOf(name) < 0) sh.getRange(1, head.length + 1).setValue(name);
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

/* ================================================================
 * 시트 꾸미기 — 메뉴 "메종도로시 → 보기 좋게 꾸미기"
 * 값은 건드리지 않고 보이는 모양만 바꿈. 여러 번 눌러도 결과가 같음.
 * (손님 페이지·관리자 앱은 칸 이름으로 읽으므로 칸 순서·서식이 바뀌어도 영향 없음)
 * ================================================================ */
const THEME = {
  ink: '#2b2326', head: '#5b3a46', headInk: '#ffffff', band: '#faf7f5', line: '#e6dfda', muted: '#8a8085',
  wait: ['#fdecdf', '#a2512f'], paid: ['#e3ecf7', '#2f5d8a'], done: ['#e6f1e2', '#3f6b3a'], cancel: ['#efebe9', '#9a8f94'],
  sold: '#fbe9e7', hidden: '#f1eeec', tabs: { 현황: '#5b3a46', 인기상품: '#c27a2c', 고객: '#2f5d8a', 주문: '#a2512f', 상품: '#3f6b3a', 설정: '#8a8085', 보관: '#b5aca8' }
};
const WIDTHS = {
  주문: { 접수시각: 128, 주문번호: 118, 상태: 84, 받는분: 84, 연락처: 112, 받는방법: 78, 주소: 240, 상품: 280, 상품금액: 86, 택배비: 82, 입금액: 92, 메모: 200, 송장번호: 120, 관리메모: 160, 소식수신: 70 },
  상품: { 노출: 52, 아이디: 70, 분류: 70, 상품명: 170, 가격: 86, 배지: 90, 사진: 150, 추가사진: 150, 컬러: 120, 사이즈: 90, 추천사이즈: 84, 설명: 280, 코디팁: 220, 인스타링크: 150, 함께입기: 90, 품절: 52, 재고: 56 }
};

function styleSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const o = ss.getSheetByName(SHEET_NAME), p = ss.getSheetByName(PRODUCT_SHEET), s = ss.getSheetByName(SETTING_SHEET);
  if (o) styleOrders_(o);
  if (p) styleProducts_(p);
  if (s) styleSettings_(s);
  styleDashboard_(ss);
  buildInsights();
  Object.keys(THEME.tabs).forEach(n => { const t = ss.getSheetByName(n); if (t) t.setTabColor(THEME.tabs[n]); });
  try { ss.toast('보기 좋게 꾸몄어요. 값은 바뀌지 않았어요.', '메종도로시', 4); } catch (e) { /* 메뉴 밖 실행 */ }
}

// 칸 이름 → 열 번호(1부터). 없으면 0
function colOf_(sh, name) {
  const w = sh.getLastColumn(); if (!w) return 0;
  const head = sh.getRange(1, 1, 1, w).getDisplayValues()[0].map(h => String(h).replace(/\s/g, ''));
  return head.indexOf(name) + 1;
}
function letter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// 공통: 머리줄·본문 글꼴, 줄무늬, 테두리, 고정
function base_(sh, widths) {
  const rows = Math.max(sh.getMaxRows(), 2), cols = Math.max(sh.getLastColumn(), 1);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(1);
  const all = sh.getRange(1, 1, rows, cols);
  all.setFontSize(10).setFontColor(THEME.ink).setVerticalAlignment('middle');
  const head = sh.getRange(1, 1, 1, cols);
  head.setBackground(THEME.head).setFontColor(THEME.headInk).setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setWrap(true);
  sh.setRowHeight(1, 36);
  sh.getBandings().forEach(b => b.remove());
  sh.getRange(1, 1, rows, cols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(THEME.head).setFirstRowColor('#ffffff').setSecondRowColor(THEME.band);
  sh.getRange(2, 1, rows - 1, cols).setBorder(null, null, true, null, null, true, THEME.line, SpreadsheetApp.BorderStyle.SOLID);
  if (widths) Object.keys(widths).forEach(n => { const c = colOf_(sh, n); if (c) sh.setColumnWidth(c, widths[n]); });
  return { rows, cols };
}
function fmt_(sh, name, rows, apply) { const c = colOf_(sh, name); if (c) apply(sh.getRange(2, c, rows - 1, 1), c); }
function cond_(range, formula, bg, fg, extra) {
  let b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([range]);
  if (bg) b = b.setBackground(bg);
  if (fg) b = b.setFontColor(fg);
  if (extra === 'bold') b = b.setBold(true);
  if (extra === 'strike') b = b.setStrikethrough(true);
  return b.build();
}

function styleOrders_(sh) {
  const { rows, cols } = base_(sh, WIDTHS.주문);
  sh.setFrozenColumns(Math.min(colOf_(sh, '받는분') || 0, 4));
  fmt_(sh, '접수시각', rows, r => r.setNumberFormat('yyyy-mm-dd hh:mm').setHorizontalAlignment('center').setFontColor(THEME.muted));
  fmt_(sh, '주문번호', rows, r => r.setFontFamily('Roboto Mono').setFontSize(9).setHorizontalAlignment('center'));
  fmt_(sh, '받는분', rows, r => r.setFontWeight('bold'));
  fmt_(sh, '연락처', rows, r => r.setHorizontalAlignment('center'));
  fmt_(sh, '받는방법', rows, r => r.setHorizontalAlignment('center'));
  ['주소', '상품', '메모', '관리메모'].forEach(n => fmt_(sh, n, rows, r => r.setWrap(true).setVerticalAlignment('top')));
  ['상품금액', '택배비', '입금액'].forEach(n => fmt_(sh, n, rows, r => r.setNumberFormat('#,##0"원"').setHorizontalAlignment('right')));
  fmt_(sh, '입금액', rows, r => r.setFontWeight('bold'));
  const sc = colOf_(sh, '상태');
  const rules = [];
  if (sc) {
    const st = sh.getRange(2, sc, rows - 1, 1);
    st.setHorizontalAlignment('center').setFontWeight('bold')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['입금대기', '입금확인', '발송완료', '픽업완료', '취소'], true).setAllowInvalid(false).build());
    const L = letter_(sc), row = sh.getRange(2, 1, rows - 1, cols);
    rules.push(
      cond_(st, `=$${L}2="입금대기"`, THEME.wait[0], THEME.wait[1]),
      cond_(st, `=$${L}2="입금확인"`, THEME.paid[0], THEME.paid[1]),
      cond_(st, `=OR($${L}2="발송완료",$${L}2="픽업완료")`, THEME.done[0], THEME.done[1]),
      cond_(row, `=$${L}2="취소"`, THEME.cancel[0], THEME.cancel[1], 'strike')
    );
  }
  const dd = (name, list, strict) => fmt_(sh, name, rows, r => r.setHorizontalAlignment('center').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(!strict).build()));
  dd('받는방법', LISTS.받는방법, true);
  dd('소식수신', LISTS.YN, true);
  const ac = colOf_(sh, '입금액');
  if (ac) rules.push(cond_(sh.getRange(2, ac, rows - 1, 1), `=$${letter_(ac)}2="확인 후 안내"`, '#fff4e5', THEME.wait[1], 'bold'));
  sh.setConditionalFormatRules(rules);
}

function styleProducts_(sh) {
  const { rows, cols } = base_(sh, WIDTHS.상품);
  sh.setFrozenColumns(Math.min(colOf_(sh, '상품명') || 0, 4));
  ['노출', '품절', '분류', '배지', '아이디', '추천사이즈'].forEach(n => fmt_(sh, n, rows, r => r.setHorizontalAlignment('center')));
  fmt_(sh, '상품명', rows, r => r.setFontWeight('bold').setWrap(true));
  fmt_(sh, '가격', rows, r => r.setNumberFormat('#,##0"원"').setHorizontalAlignment('right'));
  ['설명', '코디팁'].forEach(n => fmt_(sh, n, rows, r => r.setWrap(true).setVerticalAlignment('top')));
  ['사진', '추가사진', '인스타링크'].forEach(n => fmt_(sh, n, rows, r => r.setWrap(false).setFontColor(THEME.muted).setFontSize(9)));
  const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).setAllowInvalid(false).build();
  fmt_(sh, '노출', rows, r => r.setDataValidation(yn));
  fmt_(sh, '품절', rows, r => r.setDataValidation(yn));
  const dd = (name, list) => fmt_(sh, name, rows, r => r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build()));
  dd('분류', LISTS.분류); dd('배지', LISTS.배지); dd('추천사이즈', LISTS.추천사이즈);
  fmt_(sh, '재고', rows, r => r.setHorizontalAlignment('center').setNumberFormat('0').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).setHelpText('남은 수량 (비우면 재고 관리 안 함). 0 이 되면 다음 날 아침 자동 품절').build()));
  const rules = [], row = sh.getRange(2, 1, rows - 1, cols);
  const nc = colOf_(sh, '노출'), sc = colOf_(sh, '품절'), pc = colOf_(sh, '가격'), nm = colOf_(sh, '상품명');
  if (nc) rules.push(cond_(row, `=AND($${letter_(nm || 1)}2<>"",$${letter_(nc)}2="N")`, THEME.hidden, THEME.muted));
  if (sc) rules.push(cond_(row, `=$${letter_(sc)}2="Y"`, THEME.sold, '#a2512f'));
  const kc = colOf_(sh, '재고');
  if (kc) rules.push(cond_(sh.getRange(2, kc, rows - 1, 1), `=AND(ISNUMBER($${letter_(kc)}2),$${letter_(kc)}2<=2)`, '#fff4e5', THEME.wait[1], 'bold'));
  if (pc && nm) rules.push(cond_(sh.getRange(2, pc, rows - 1, 1), `=AND($${letter_(nm)}2<>"",$${letter_(pc)}2="")`, '#fff4e5', THEME.wait[1]));
  sh.setConditionalFormatRules(rules);
}

function styleSettings_(sh) {
  const rows = Math.max(sh.getLastRow(), 2);
  sh.setHiddenGridlines(true).setFrozenRows(1);
  sh.getRange(1, 1, 1, 3).setBackground(THEME.head).setFontColor(THEME.headInk).setFontWeight('bold').setHorizontalAlignment('center');
  sh.setRowHeight(1, 36);
  sh.getRange(2, 1, rows - 1, 1).setFontWeight('bold').setBackground(THEME.band).setVerticalAlignment('middle');
  sh.getRange(2, 2, rows - 1, 1).setBackground('#fffdf3').setFontSize(11).setWrap(true).setVerticalAlignment('middle');
  sh.getRange(2, 3, rows - 1, 1).setFontColor(THEME.muted).setFontStyle('italic').setFontSize(9).setWrap(true);
  sh.getRange(1, 1, rows, 3).setBorder(true, true, true, true, true, true, THEME.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.setColumnWidth(1, 120).setColumnWidth(2, 320).setColumnWidth(3, 300);
  for (let r = 2; r <= rows; r++) sh.setRowHeight(r, 34);
}

// 한눈에 보는 현황 탭 (수식만 있음 — 손님 페이지·관리자 앱은 읽지 않음)
function styleDashboard_(ss) {
  const o = ss.getSheetByName(SHEET_NAME), p = ss.getSheetByName(PRODUCT_SHEET);
  if (!o || !p) return;
  let d = ss.getSheetByName('현황');
  if (!d) { d = ss.insertSheet('현황', 0); }
  d.clear(); d.setHiddenGridlines(true);
  const c = n => letter_(colOf_(o, n)), q = n => letter_(colOf_(p, n));
  const O = `'${SHEET_NAME}'!`, P = `'${PRODUCT_SHEET}'!`;
  const items = [
    ['오늘 들어온 주문', `=COUNTIFS(${O}${c('접수시각')}2:${c('접수시각')},">="&TODAY())`, '건'],
    ['입금 확인할 주문', `=COUNTIF(${O}${c('상태')}2:${c('상태')},"입금대기")`, '건'],
    ['보낼 택배', `=COUNTIFS(${O}${c('상태')}2:${c('상태')},"입금확인",${O}${c('받는방법')}2:${c('받는방법')},"택배")`, '건'],
    ['픽업 대기', `=COUNTIFS(${O}${c('상태')}2:${c('상태')},"입금확인",${O}${c('받는방법')}2:${c('받는방법')},"매장 픽업")`, '건'],
    ['이번 달 입금액', `=SUMIFS(${O}${c('입금액')}2:${c('입금액')},${O}${c('상태')}2:${c('상태')},"<>입금대기",${O}${c('상태')}2:${c('상태')},"<>취소",${O}${c('접수시각')}2:${c('접수시각')},">="&EOMONTH(TODAY(),-1)+1)`, '원'],
    ['판매 중인 옷', `=COUNTIFS(${P}${q('노출')}2:${q('노출')},"Y",${P}${q('품절')}2:${q('품절')},"<>Y")`, '벌'],
    ['품절 표시', `=COUNTIFS(${P}${q('노출')}2:${q('노출')},"Y",${P}${q('품절')}2:${q('품절')},"Y")`, '벌'],
    ['가격 미입력', `=COUNTIFS(${P}${q('노출')}2:${q('노출')},"Y",${P}${q('가격')}2:${q('가격')},"")`, '벌']
  ];
  d.getRange('B2').setValue('메종도로시 현황').setFontSize(18).setFontWeight('bold').setFontColor(THEME.head);
  d.getRange('B3').setFormula('="기준 "&TEXT(NOW(),"yyyy-mm-dd hh:mm")&" · 시트를 열 때마다 새로 계산"').setFontColor(THEME.muted).setFontSize(9);
  items.forEach((it, i) => {
    const r = 5 + i;
    d.getRange(r, 2).setValue(it[0]).setFontColor(THEME.ink).setFontSize(11);
    d.getRange(r, 3).setFormula(it[1]).setNumberFormat(it[2] === '원' ? '#,##0"원"' : '0"' + it[2] + '"')
      .setFontSize(16).setFontWeight('bold').setHorizontalAlignment('right').setFontColor(i === 1 || i === 7 ? THEME.wait[1] : THEME.head);
    d.setRowHeight(r, 38);
  });
  d.getRange(5, 2, items.length, 2).setBorder(true, true, true, true, null, true, THEME.line, SpreadsheetApp.BorderStyle.SOLID)
    .setVerticalAlignment('middle');
  d.getRange(5, 2, items.length, 1).setBackground(THEME.band);
  d.setColumnWidth(1, 24).setColumnWidth(2, 170).setColumnWidth(3, 150);
  d.getRange(5 + items.length + 1, 2).setValue('주문 처리·상품 등록은 관리자 앱에서 하면 편해요. 이 탭은 보기 전용이에요.').setFontColor(THEME.muted).setFontSize(9);
}


/* ================================================================
 * 자동화 — 메뉴 "메종도로시 → 자동화 켜기"
 * 매일 오전 8:40  dailyJob    : 입금기한 확인(알림·선택 시 자동 취소) → 오래된 완료 주문 보관 → 아침 요약 메일(월요일은 주간 리포트 포함)
 * 매주 월 오전 6시 weeklyBackup: 시트 전체를 드라이브 "메종도로시 백업" 폴더에 복사, 최근 8개만 남김(오래된 것은 휴지통)
 * 설정 탭의 입금기한·자동취소·보관기간으로 조절. 켜고 끄는 것은 몇 번을 눌러도 같음.
 * ================================================================ */
const AUTO_TZ = 'Asia/Seoul';
const ARCHIVE_SHEET = '보관';
const BACKUP_FOLDER = '메종도로시 백업';
const BACKUP_KEEP = 8;
const AUTO_HANDLERS = ['dailyJob', 'weeklyBackup'];

function enableAutomation() {
  disableAutomation(true);
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(8).nearMinute(40).inTimezone(AUTO_TZ).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).inTimezone(AUTO_TZ).create();
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET);
  if (s) ensureSettingRows_(s);
  toast_('자동화를 켰어요. 매일 아침 요약 메일과 매주 월요일 백업이 진행돼요.');
}
function disableAutomation(quiet) {
  ScriptApp.getProjectTriggers().forEach(t => { if (AUTO_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  if (quiet !== true) toast_('자동화를 껐어요.');
}
function toast_(msg) { try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, '메종도로시', 5); } catch (e) { /* 예약 실행 중 */ } }

// 설정 탭에 자동화 항목이 없으면 추가 (기존 값은 그대로)
function ensureSettingRows_(sh) {
  const have = sh.getDataRange().getDisplayValues().map(r => String(r[0]).replace(/\s/g, ''));
  SETTING_ROWS.slice(1).forEach(r => { if (have.indexOf(r[0]) < 0) sh.appendRow(r); });
}
function setting_(key, def) {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTING_SHEET);
  if (!s) return def;
  const row = s.getDataRange().getDisplayValues().find(r => String(r[0]).replace(/\s/g, '') === key);
  return row && String(row[1]).trim() !== '' ? String(row[1]).trim() : def;
}
function ordersTable_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { sh, head: [], rows: [] };
  const vals = sh.getDataRange().getValues(), disp = sh.getDataRange().getDisplayValues();
  const head = disp[0].map(h => String(h).replace(/\s/g, ''));
  const i = n => head.indexOf(n);
  const rows = vals.slice(1).map((r, k) => ({
    row: k + 2, at: r[i('접수시각')] instanceof Date ? r[i('접수시각')] : new Date(disp[k + 1][i('접수시각')]),
    no: disp[k + 1][i('주문번호')], status: disp[k + 1][i('상태')], name: disp[k + 1][i('받는분')],
    method: disp[k + 1][i('받는방법')], items: disp[k + 1][i('상품')], all: r[i('입금액')], note: i('관리메모') >= 0 ? disp[k + 1][i('관리메모')] : ''
  })).filter(o => o.no);
  return { sh, head, rows };
}
const days_ = d => (Date.now() - d.getTime()) / 86400000;
const won_ = n => (Number(n) > 0 ? Number(n).toLocaleString('ko-KR') + '원' : '확인 후 안내');

// 1) 입금기한 확인: 지난 주문에 관리메모 표시, 자동취소가 Y 면 취소
function checkOverdue_() {
  const limit = Number(setting_('입금기한', '2')) || 2;
  const cancel = /^y/i.test(setting_('자동취소', 'N'));
  const t = ordersTable_(); if (!t.sh) return [];
  const sc = t.head.indexOf('상태') + 1, nc = t.head.indexOf('관리메모') + 1;
  const late = t.rows.filter(o => o.status === '입금대기' && days_(o.at) >= limit);
  late.forEach(o => {
    if (cancel && sc) { t.sh.getRange(o.row, sc).setValue('취소'); o.status = '취소'; }
    const memo = cancel ? '입금기한 지나 자동 취소' : '입금기한 지남';
    if (nc && o.note.indexOf(memo) < 0) t.sh.getRange(o.row, nc).setValue(o.note ? o.note + ' / ' + memo : memo);
  });
  return late.map(o => ({ ...o, cancelled: cancel }));
}

// 2) 오래된 완료·취소 주문을 보관 탭으로 (아래 줄부터 지워서 줄 번호가 밀리지 않게)
function archiveOld_() {
  const keep = Number(setting_('보관기간', '90')) || 90;
  const t = ordersTable_(); if (!t.sh) return 0;
  const old = t.rows.filter(o => /발송완료|픽업완료|취소/.test(o.status) && days_(o.at) >= keep);
  if (!old.length) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let a = ss.getSheetByName(ARCHIVE_SHEET);
  if (!a) { a = ss.insertSheet(ARCHIVE_SHEET); a.appendRow(t.sh.getRange(1, 1, 1, t.sh.getLastColumn()).getValues()[0]); a.setFrozenRows(1); a.setTabColor('#8a8085'); }
  const w = t.sh.getLastColumn();
  old.forEach(o => a.appendRow(t.sh.getRange(o.row, 1, 1, w).getValues()[0]));
  old.map(o => o.row).sort((x, y) => y - x).forEach(r => t.sh.deleteRow(r));
  return old.length;
}

// 3) 아침 요약 메일
function dailyJob() {
  const late = checkOverdue_();
  const archived = archiveOld_();
  const autoSold = soldOutByStock_();
  const ins = buildInsights();
  const t = ordersTable_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const p = ss.getSheetByName(PRODUCT_SHEET);
  const pv = p ? p.getDataRange().getDisplayValues() : [[]];
  const ph = pv[0].map(h => String(h).replace(/\s/g, ''));
  const prod = pv.slice(1).filter(r => r[ph.indexOf('상품명')] && r[ph.indexOf('노출')] !== 'N');
  const noPrice = prod.filter(r => !String(r[ph.indexOf('가격')]).replace(/[^\d]/g, ''));
  const sold = prod.filter(r => r[ph.indexOf('품절')] === 'Y');
  const recent = t.rows.filter(o => days_(o.at) < 1);
  const wait = t.rows.filter(o => o.status === '입금대기');
  const ship = t.rows.filter(o => o.status === '입금확인' && !/픽업/.test(o.method));
  const pick = t.rows.filter(o => o.status === '입금확인' && /픽업/.test(o.method));
  const monday = Utilities.formatDate(new Date(), AUTO_TZ, 'u') === '1';
  const line = o => `· ${o.name} (${o.no}) ${won_(o.all)}`;
  const parts = [
    `메종도로시 ${Utilities.formatDate(new Date(), AUTO_TZ, 'M월 d일')} 아침 요약`, '',
    `■ 지난 24시간 새 주문 ${recent.length}건`, ...recent.map(line), '',
    `■ 입금 확인할 주문 ${wait.length}건`, ...wait.map(line), '',
    `■ 보낼 택배 ${ship.length}건`, ...ship.map(line), '',
    `■ 픽업 대기 ${pick.length}건`, ...pick.map(line)
  ];
  if (late.length) parts.push('', `■ 입금기한 지난 주문 ${late.length}건${late[0].cancelled ? ' (자동 취소함)' : ''}`, ...late.map(line));
  if (archived) parts.push('', `■ 오래된 완료 주문 ${archived}건을 "보관" 탭으로 옮김`);
  if (noPrice.length) parts.push('', `■ 가격이 비어 있는 옷 ${noPrice.length}벌 — 손님 화면에 "가격 문의"로 보여요`, ...noPrice.slice(0, 10).map(r => '· ' + r[ph.indexOf('상품명')]));
  if (sold.length) parts.push('', `■ 품절 표시 ${sold.length}벌`);
  if (autoSold.length) parts.push('', `■ 재고 0 이라 자동 품절 처리 ${autoSold.length}벌`, ...autoSold.map(n => '· ' + n));
  if (ins.restock.length) parts.push('', `■ 다시 들여올 옷 (재고 2벌 이하 · 최근 30일 판매)`, ...ins.restock.map(x => `· ${x.name} 재고 ${x.stock} · 30일 ${x.d30}벌`));
  if (ins.best.length) parts.push('', '■ 최근 30일 인기 옷', ...ins.best.slice(0, 3).map((x, k) => `${k + 1}. ${x.name} ${x.d30}벌`));
  if (monday) parts.push('', ...weeklyReport_(t.rows));
  parts.push('', '— 주문 처리는 관리자 앱에서, 자세한 숫자는 시트 "현황" 탭에서 볼 수 있어요.');
  if (monday && ins.dormant) parts.push('', `■ 다시 연락해볼 손님 ${ins.dormant}명 (소식 수신 동의 · 60일 넘게 주문 없음) — 고객 탭에서 확인`);
  const todo = recent.length + wait.length + ship.length + pick.length + late.length + archived + autoSold.length;
  if (!todo && !monday) return { sent: false };   // 할 일이 없는 날은 메일 안 보냄 (월요일 주간 리포트는 항상)
  const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  const subject = `[메종도로시] 아침 요약 · 입금확인 ${wait.length} · 택배 ${ship.length} · 새 주문 ${recent.length}`;
  if (to) MailApp.sendEmail(to, subject, parts.join('\n'));
  return { sent: !!to, subject };
}

// 월요일: 지난 7일 주문·입금액·많이 주문된 옷
function weeklyReport_(rows) {
  const week = rows.filter(o => days_(o.at) < 7 && o.status !== '취소');
  const sum = week.filter(o => /입금확인|발송완료|픽업완료/.test(o.status)).reduce((s, o) => s + (Number(o.all) || 0), 0);
  const count = {};
  week.forEach(o => String(o.items).split('\n').forEach(l => { const m = l.match(/^([^(]+)\(.*\)×(\d+)/); if (m) count[m[1].trim()] = (count[m[1].trim()] || 0) + Number(m[2]); }));
  const top = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 3);
  return [`■ 지난주 리포트`, `· 주문 ${week.length}건 · 입금 확인된 금액 ${sum.toLocaleString('ko-KR')}원`,
    ...(top.length ? ['· 많이 주문된 옷: ' + top.map(n => `${n} ${count[n]}벌`).join(', ')] : [])];
}

// 4) 주간 백업 — 시트 전체 복사, 최근 BACKUP_KEEP 개만 남김
function weeklyBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const name = `${ss.getName()} 백업 ${Utilities.formatDate(new Date(), AUTO_TZ, 'yyyy-MM-dd')}`;
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  const files = []; const f = folder.getFiles();
  while (f.hasNext()) files.push(f.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(BACKUP_KEEP).forEach(x => x.setTrashed(true));
  return name;
}


/* ================================================================
 * 고객 · 인기상품 탭 — 주문·보관 탭에서 계산 (매일 아침 자동, 또는 메뉴 "고객·인기상품 새로 계산")
 * 두 탭은 계산 결과라 직접 고쳐도 다음 계산 때 다시 쓰임. 단 고객 탭의 "메모"는 연락처별로 유지됨.
 * 마케팅(신상·할인 문자)은 소식수신 Y 인 손님에게만 보낼 것 — 문자 앞에 (광고), 끝에 수신거부 방법 표기
 * ================================================================ */
const CUSTOMER_SHEET = '고객', BEST_SHEET = '인기상품';
const DONE = /입금확인|발송완료|픽업완료/;

// 주문 한 줄의 상품 칸 "니트 후드 가디건(아이보리/평소 66)×1 가격문의" → [{name,color,size,q}]
function parseItems_(text) {
  return String(text || '').split('\n').map(l => {
    const m = l.match(/^(.+?)\((.*)\)×(\d+)/); if (!m) return null;
    const opts = m[2].split('/').map(x => x.trim()).filter(Boolean);
    const size = opts.find(x => /^(평소 \d{2}|[SML]|XL|XXL|FREE|프리.*|\d{2})$/i.test(x)) || '';
    const color = opts.filter(x => x !== size).join('/');
    return { name: m[1].trim(), color, size, q: Number(m[3]) || 1 };
  }).filter(Boolean);
}
function allOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), out = [];
  [SHEET_NAME, ARCHIVE_SHEET].forEach(n => {
    const sh = ss.getSheetByName(n); if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getDataRange().getValues(), d = sh.getDataRange().getDisplayValues();
    const h = d[0].map(x => String(x).replace(/\s/g, '')), i = k => h.indexOf(k);
    v.slice(1).forEach((r, k) => {
      const dr = d[k + 1]; if (!dr[i('주문번호')]) return;
      const at = r[i('접수시각')] instanceof Date ? r[i('접수시각')] : new Date(dr[i('접수시각')]);
      out.push({ at, status: dr[i('상태')], name: dr[i('받는분')], phone: dr[i('연락처')], method: dr[i('받는방법')],
        items: parseItems_(dr[i('상품')]), all: Number(String(r[i('입금액')]).replace(/[^\d]/g, '')) || 0, ad: i('소식수신') >= 0 ? dr[i('소식수신')] : '' });
    });
  });
  return out;
}
function productsMap_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRODUCT_SHEET);
  const map = {}; if (!sh || sh.getLastRow() < 2) return { map, sh, head: [] };
  const v = sh.getDataRange().getDisplayValues(), h = v[0].map(x => String(x).replace(/\s/g, ''));
  v.slice(1).forEach((r, k) => {
    const g = n => (h.indexOf(n) >= 0 ? r[h.indexOf(n)] : '');
    if (!g('상품명')) return;
    const st = String(g('재고')).replace(/[^\d]/g, '');
    map[g('상품명')] = { row: k + 2, cat: g('분류'), price: Number(String(g('가격')).replace(/[^\d]/g, '')) || 0, show: g('노출') !== 'N', sold: g('품절') === 'Y', stock: st === '' ? null : Number(st) };
  });
  return { map, sh, head: h };
}
// 재고가 0 이 된 옷은 품절로 (재고 칸이 비어 있으면 건드리지 않음)
function soldOutByStock_() {
  const { map, sh, head } = productsMap_(); const sc = head.indexOf('품절') + 1, done = [];
  if (!sc) return done;
  Object.keys(map).forEach(n => { const p = map[n]; if (p.stock === 0 && !p.sold && p.show) { sh.getRange(p.row, sc).setValue('Y'); done.push(n); } });
  return done;
}
const top_ = obj => Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0] || '';

function buildInsights() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orders = allOrders_().filter(o => o.status !== '취소');
  const { map } = productsMap_();
  const now = Date.now(), DAY = 86400000;

  // ----- 인기상품 -----
  const P = {};
  orders.forEach(o => o.items.forEach(it => {
    const x = P[it.name] || (P[it.name] = { name: it.name, qty: 0, d30: 0, d7: 0, orders: 0, sizes: {}, colors: {}, last: 0 });
    x.qty += it.q; x.orders += 1; x.last = Math.max(x.last, o.at.getTime());
    if (now - o.at < 30 * DAY) x.d30 += it.q;
    if (now - o.at < 7 * DAY) x.d7 += it.q;
    if (it.size) x.sizes[it.size] = (x.sizes[it.size] || 0) + it.q;
    if (it.color) x.colors[it.color] = (x.colors[it.color] || 0) + it.q;
  }));
  Object.keys(map).forEach(n => { if (!P[n] && map[n].show) P[n] = { name: n, qty: 0, d30: 0, d7: 0, orders: 0, sizes: {}, colors: {}, last: 0 }; });
  const list = Object.values(P).map(x => {
    const p = map[x.name];
    const state = !p ? '목록에 없음' : !p.show ? '숨김' : p.sold ? '품절' : '판매 중';
    const restock = p && p.stock !== null && p.stock <= 2 && x.d30 > 0;
    const promote = p && p.show && !p.sold && x.d30 === 0;
    return { ...x, cat: p ? p.cat : '', price: p ? p.price : 0, stock: p ? p.stock : null, state, restock, promote };
  }).sort((a, b) => b.d30 - a.d30 || b.qty - a.qty || a.name.localeCompare(b.name));
  const BH = ['순위', '상품명', '분류', '최근 7일', '최근 30일', '전체 판매', '주문 건수', '예상 매출', '많이 나간 사이즈', '많이 나간 컬러', '재고', '상태', '추천', '마지막 주문'];
  const brows = list.map((x, k) => [x.qty || x.d30 ? k + 1 : '-', x.name, x.cat, x.d7, x.d30, x.qty, x.orders,
    x.price ? x.price * x.qty : (x.qty ? '가격 미입력' : 0), top_(x.sizes), top_(x.colors), x.stock === null ? '' : x.stock, x.state,
    x.restock ? '다시 들여오기' : x.promote ? '홍보하기 (30일 판매 없음)' : (x.d30 >= 3 ? 'BEST' : ''), x.last ? new Date(x.last) : '']);
  writeTable_(ss, BEST_SHEET, BH, brows, { widths: [48, 170, 70, 70, 76, 76, 70, 96, 110, 110, 56, 80, 170, 120], money: [8], date: [14], center: [1, 3, 4, 5, 6, 7, 11, 12] },
    `인기상품 · 취소 제외 주문 기준 · ${Utilities.formatDate(new Date(), AUTO_TZ, 'yyyy-MM-dd HH:mm')} 계산`);

  // ----- 고객 -----
  const C = {};
  orders.forEach(o => {
    const key = String(o.phone).replace(/[^\d]/g, ''); if (!key) return;
    const c = C[key] || (C[key] = { phone: o.phone, name: o.name, n: 0, spent: 0, first: o.at, last: o.at, sizes: {}, cats: {}, methods: {}, ad: 'N' });
    c.n += 1; if (DONE.test(o.status)) c.spent += o.all;
    if (o.at < c.first) c.first = o.at;
    if (o.at >= c.last) { c.last = o.at; c.name = o.name; if (o.ad) c.ad = o.ad; }   // 가장 최근 주문의 이름·동의 여부
    c.methods[o.method] = (c.methods[o.method] || 0) + 1;
    o.items.forEach(it => {
      if (/^평소 \d{2}$/.test(it.size)) c.sizes[it.size.replace('평소 ', '')] = (c.sizes[it.size.replace('평소 ', '')] || 0) + 1;
      const cat = map[it.name] && map[it.name].cat; if (cat) c.cats[cat] = (c.cats[cat] || 0) + it.q;
    });
  });
  // 손으로 적은 메모는 연락처별로 지킴
  const memo = {};
  const old = ss.getSheetByName(CUSTOMER_SHEET);
  if (old && old.getLastRow() > 2) {
    const v = old.getDataRange().getDisplayValues(); const hi = v.findIndex(r => r.indexOf('연락처') >= 0);
    if (hi >= 0) { const h = v[hi], pi = h.indexOf('연락처'), mi = h.indexOf('메모(직접 입력)'); v.slice(hi + 1).forEach(r => { if (mi >= 0 && r[mi]) memo[String(r[pi]).replace(/[^\d]/g, '')] = r[mi]; }); }
  }
  let dormant = 0;
  const grade = c => (c.spent >= 300000 || c.n >= 4 ? 'VIP' : c.n >= 2 ? '단골' : '신규');
  const crow = Object.keys(C).map(k => C[k]).sort((a, b) => b.spent - a.spent || b.n - a.n).map(c => {
    const days = Math.floor((now - c.last) / DAY);
    const call = c.ad === 'Y' && days >= 60;
    if (call) dormant++;
    return [grade(c), c.name, "'" + c.phone, c.n, c.spent, c.first, c.last, days, top_(c.sizes) ? top_(c.sizes) + ' 사이즈' : '', top_(c.cats), top_(c.methods), c.ad === 'Y' ? 'Y' : 'N',
      call ? '다시 연락해보기' : days >= 90 ? '휴면' : '', memo[String(c.phone).replace(/[^\d]/g, '')] || ''];
  });
  const CH = ['등급', '이름', '연락처', '주문 횟수', '누적 구매액', '첫 주문', '최근 주문', '지난 일수', '평소 사이즈', '자주 산 분류', '받는 방법', '소식 수신', '마케팅', '메모(직접 입력)'];
  writeTable_(ss, CUSTOMER_SHEET, CH, crow, { widths: [56, 84, 112, 70, 96, 96, 96, 70, 90, 90, 84, 70, 110, 220], money: [5], date: [6, 7], center: [1, 4, 8, 9, 11, 12, 13] },
    `고객 ${crow.length}명 · VIP 누적 30만원 또는 4회 이상, 단골 2회 이상 · 소식 수신 Y 손님에게만 마케팅 문자 가능 ((광고) 표기·수신거부 안내 필수)`);
  return { best: list.filter(x => x.d30 > 0), restock: list.filter(x => x.restock), dormant, customers: crow.length };
}

// 결과 표 쓰기: 1행 설명, 2행 머리줄, 3행부터 내용 (서식 포함, 매번 새로 씀)
function writeTable_(ss, name, head, rows, o, note) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, 1);
  sh.getBandings().forEach(b => b.remove());
  sh.clear(); sh.setHiddenGridlines(true);
  sh.getRange(1, 1).setValue(note || '').setFontColor(THEME.muted).setFontSize(9).setFontStyle('italic');
  sh.getRange(2, 1, 1, head.length).setValues([head]).setBackground(THEME.head).setFontColor(THEME.headInk).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  sh.setFrozenRows(2); sh.setRowHeight(2, 34);
  if (rows.length) {
    const r = sh.getRange(3, 1, rows.length, head.length);
    r.setValues(rows).setFontSize(10).setVerticalAlignment('middle');
    (o.money || []).forEach(c => sh.getRange(3, c, rows.length, 1).setNumberFormat('#,##0"원"'));
    (o.date || []).forEach(c => sh.getRange(3, c, rows.length, 1).setNumberFormat('yyyy-mm-dd'));
    (o.center || []).forEach(c => sh.getRange(3, c, rows.length, 1).setHorizontalAlignment('center'));
    sh.getRange(2, 1, rows.length + 1, head.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
      .setHeaderRowColor(THEME.head).setFirstRowColor('#ffffff').setSecondRowColor(THEME.band);
  } else sh.getRange(3, 1).setValue('아직 주문이 없어요').setFontColor(THEME.muted);
  (o.widths || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
  if (THEME.tabs[name]) sh.setTabColor(THEME.tabs[name]);
  // 눈에 띄게: 고객 등급·마케팅 대상, 인기상품 추천·품절
  const n = Math.max(rows.length, 1), col = h => head.indexOf(h) + 1, L = h => letter_(col(h)), rng = h => sh.getRange(3, col(h), n, 1);
  const eq = (h, v) => '=$' + L(h) + '3="' + v + '"';
  const rules = [];
  if (col('등급')) rules.push(cond_(rng('등급'), eq('등급', 'VIP'), '#f6e3ea', '#6b3a4c', 'bold'), cond_(rng('등급'), eq('등급', '단골'), THEME.paid[0], THEME.paid[1]));
  if (col('마케팅')) rules.push(cond_(rng('마케팅'), eq('마케팅', '다시 연락해보기'), THEME.wait[0], THEME.wait[1], 'bold'));
  if (col('추천')) rules.push(cond_(rng('추천'), eq('추천', '다시 들여오기'), THEME.wait[0], THEME.wait[1], 'bold'),
    cond_(rng('추천'), eq('추천', 'BEST'), '#f6e3ea', '#6b3a4c', 'bold'),
    cond_(rng('추천'), '=LEFT($' + L('추천') + '3,2)="홍보"', THEME.paid[0], THEME.paid[1]));
  if (col('상태') && name === BEST_SHEET) rules.push(cond_(sh.getRange(3, 1, n, head.length), eq('상태', '품절'), THEME.sold, null));
  sh.setConditionalFormatRules(rules);
}
