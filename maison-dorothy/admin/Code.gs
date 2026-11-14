/**
 * 메종도로시 관리자 앱 — 별도 Apps Script 프로젝트 (공개 주문 스크립트와 분리)
 *
 * 설치 (운영 시트를 만든 구글 계정으로, 1회)
 * 1. script.google.com → 새 프로젝트 → 이름 "메종도로시 관리자"
 * 2. Code.gs 에 이 파일 붙여넣기, 파일 추가(+) → HTML → 이름 "Index" → admin/Index.html 붙여넣기
 * 3. 아래 SHEET_ID 에 운영 시트 주소의 /d/ 와 /edit 사이 값을 넣고 저장
 * 4. 배포 → 새 배포 → 웹 앱 / 실행 사용자: 나 / 액세스 권한: **나만** → 배포 → 권한 허용
 * 5. 나온 주소를 휴대폰 크롬·사파리로 열고 "홈 화면에 추가"
 *
 * 보안: 액세스 권한을 "나만"으로 두면 이 계정으로 로그인해야만 열립니다.
 * 모든 기능은 guard_() 로 한 번 더 관리자 본인인지 확인합니다.
 * 다른 사람(예: 매장 대표)이 쓰게 하려면 그 사람 계정으로 시트 소유권을 넘기고 이 프로젝트를 그 계정에서 다시 배포하세요.
 */
const SHEET_ID = '';
const SITE_URL = 'https://remnant1981-bit.github.io/remnant1981/maison-dorothy/';
const ORDER = '주문', PRODUCT = '상품', SETTING = '설정';
const PHOTO_FOLDER = '메종도로시 상품사진';
const STATUSES = ['입금대기', '입금확인', '발송완료', '픽업완료', '취소'];
const PKEY = { show: '노출', id: '아이디', cat: '분류', name: '상품명', price: '가격', badge: '배지', img: '사진', gallery: '추가사진',
  colors: '컬러', sizes: '사이즈', fit: '추천사이즈', desc: '설명', tip: '코디팁', post: '인스타링크', pair: '함께입기', soldOut: '품절' };
const SETTING_KEYS = ['공지', '영업시간안내', '영업요일', '오픈', '마감', '전화', '카톡채널', '밴드', '입금계좌'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('메종도로시 관리자')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- 공통 ---------- */
function guard_() {
  const me = Session.getActiveUser().getEmail(), owner = Session.getEffectiveUser().getEmail();
  if (!me || me !== owner) throw new Error('관리자 계정으로만 쓸 수 있어요. 배포 설정의 액세스 권한이 "나만"인지 확인해 주세요.');
  return me;
}
function ss_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function sh_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error(`"${name}" 탭이 없어요. 운영 시트에서 메종도로시 → 시트 준비하기를 먼저 눌러 주세요.`);
  return s;
}
function table_(sh) {
  if (sh.getLastRow() === 0) return { head: [], rows: [] };
  const v = sh.getDataRange().getDisplayValues();
  return { head: v[0].map(h => String(h).replace(/\s/g, '')), rows: v.slice(1) };
}
function ensureCol_(sh, name) {
  const t = table_(sh); let i = t.head.indexOf(name);
  if (i < 0) { i = t.head.length; sh.getRange(1, i + 1).setValue(name).setFontWeight('bold'); }
  return i;
}
function findRow_(sh, colName, key) {
  const t = table_(sh), c = t.head.indexOf(colName);
  if (c < 0) throw new Error(`"${colName}" 칸이 없어요`);
  const i = t.rows.findIndex(r => r[c] === String(key));
  if (i < 0) throw new Error('찾을 수 없어요. 새로고침 후 다시 해 주세요.');
  return { row: i + 2, head: t.head, values: t.rows[i] };
}
// 시트가 값을 수식으로 실행하지 않게
function cell_(v, n) {
  const t = String(v == null ? '' : v).slice(0, n || 500);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}
function pick_(head, row, name) { const i = head.indexOf(name); return i < 0 ? '' : row[i]; }

/* ---------- 불러오기 ---------- */
function loadAll() {
  const me = guard_();
  const ss = ss_();
  const o = ss.getSheetByName(ORDER) ? table_(sh_(ORDER)) : { head: [], rows: [] };
  const orders = o.rows.map(r => ({
    at: pick_(o.head, r, '접수시각'), no: pick_(o.head, r, '주문번호'), status: pick_(o.head, r, '상태') || '입금대기',
    name: pick_(o.head, r, '받는분'), phone: pick_(o.head, r, '연락처'), method: pick_(o.head, r, '받는방법'),
    address: pick_(o.head, r, '주소'), items: pick_(o.head, r, '상품'), sub: pick_(o.head, r, '상품금액'),
    ship: pick_(o.head, r, '택배비'), all: pick_(o.head, r, '입금액'), memo: pick_(o.head, r, '메모'),
    tracking: pick_(o.head, r, '송장번호'), note: pick_(o.head, r, '관리메모')
  })).filter(x => x.no).reverse();
  const p = ss.getSheetByName(PRODUCT) ? table_(sh_(PRODUCT)) : { head: [], rows: [] };
  const products = p.rows.map(r => {
    const x = {}; Object.keys(PKEY).forEach(k => { x[k] = pick_(p.head, r, PKEY[k]); }); return x;
  }).filter(x => x.id || x.name);
  const settings = {};
  if (ss.getSheetByName(SETTING)) sh_(SETTING).getDataRange().getDisplayValues().forEach(r => {
    const k = String(r[0] || '').replace(/\s/g, ''); if (SETTING_KEYS.indexOf(k) >= 0) settings[k] = r[1];
  });
  return { orders, products, settings, statuses: STATUSES, site: SITE_URL, me, today: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') };
}

/* ---------- 주문 ---------- */
function updateOrder(no, patch) {
  guard_();
  const sh = sh_(ORDER), f = findRow_(sh, '주문번호', no);
  const map = { status: '상태', all: '입금액', tracking: '송장번호', note: '관리메모' };
  Object.keys(patch || {}).forEach(k => {
    if (!map[k]) return;
    let v = patch[k];
    if (k === 'status' && STATUSES.indexOf(v) < 0) throw new Error('알 수 없는 상태예요');
    if (k === 'all') { const d = String(v).replace(/[^\d]/g, ''); v = d ? Number(d) : '확인 후 안내'; }
    else v = cell_(v, 200);
    sh.getRange(f.row, ensureCol_(sh, map[k]) + 1).setValue(v);
  });
  return true;
}

/* ---------- 상품 ---------- */
function productRow_(head, p, old) {
  return head.map((h, i) => {
    const k = Object.keys(PKEY).find(x => PKEY[x] === h);
    if (!k) return old ? old[i] : '';
    let v = p[k];
    if (k === 'show') return v === false || v === 'N' ? 'N' : 'Y';
    if (k === 'soldOut') return v === true || v === 'Y' ? 'Y' : 'N';
    if (k === 'price') { const d = String(v || '').replace(/[^\d]/g, ''); return d ? Number(d) : ''; }
    if (Array.isArray(v)) v = v.join(', ');
    return cell_(v, k === 'desc' ? 400 : 300);
  });
}
function saveProduct(p) {
  guard_();
  if (!p || !String(p.name || '').trim()) throw new Error('상품명을 입력해 주세요');
  const sh = sh_(PRODUCT), t = table_(sh), ci = t.head.indexOf('아이디');
  if (ci < 0) throw new Error('"아이디" 칸이 없어요');
  let id = String(p.id || '').trim();
  if (!id) {   // 새 상품: 겹치지 않는 아이디 만들기
    const used = new Set(t.rows.map(r => r[ci]));
    do { id = 'p' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5); } while (used.has(id));
  }
  if (!/^[\w-]{1,30}$/.test(id)) throw new Error('아이디는 영문·숫자만 쓸 수 있어요');
  p.id = id;
  const i = t.rows.findIndex(r => r[ci] === id);
  if (i >= 0) {
    const row = productRow_(t.head, p, t.rows[i]);
    sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
  } else {
    const row = productRow_(t.head, p, null);
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, row.length).setValues([row]);
  }
  return id;
}
function setProductFlag(id, field, on) {
  guard_();
  if (field !== 'show' && field !== 'soldOut') throw new Error('바꿀 수 없는 항목이에요');
  const sh = sh_(PRODUCT), f = findRow_(sh, '아이디', id), c = f.head.indexOf(PKEY[field]);
  if (c < 0) throw new Error(`"${PKEY[field]}" 칸이 없어요`);
  sh.getRange(f.row, c + 1).setValue(on ? 'Y' : 'N');
  return true;
}
// 순서 바꾸기: 'up' | 'down' | 'top'
function moveProduct(id, dir) {
  guard_();
  const sh = sh_(PRODUCT), f = findRow_(sh, '아이디', id), last = sh.getLastRow();
  const target = dir === 'top' ? 2 : dir === 'up' ? f.row - 1 : f.row + 1;
  if (target < 2 || target > last || target === f.row) return false;
  const w = sh.getLastColumn();
  if (dir === 'top') {
    const v = sh.getRange(f.row, 1, 1, w).getValues();
    sh.deleteRow(f.row); sh.insertRowAfter(1); sh.getRange(2, 1, 1, w).setValues(v);
  } else {
    const a = sh.getRange(f.row, 1, 1, w).getValues(), b = sh.getRange(target, 1, 1, w).getValues();
    sh.getRange(f.row, 1, 1, w).setValues(b); sh.getRange(target, 1, 1, w).setValues(a);
  }
  return true;
}
function deleteProduct(id) {
  guard_();
  const sh = sh_(PRODUCT), f = findRow_(sh, '아이디', id);
  sh.deleteRow(f.row);
  return true;
}

/* ---------- 사진 올리기 (드라이브 폴더, 링크 있는 사람 보기) ---------- */
function uploadPhoto(dataUrl, name) {
  guard_();
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('사진 파일(JPG·PNG·WEBP)만 올릴 수 있어요');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('사진이 너무 커요 (8MB 이하)');
  const safe = String(name || 'photo').replace(/[^\w.-]/g, '_').slice(0, 60) || 'photo';
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  const file = folder.createFile(Utilities.newBlob(bytes, m[1], safe));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

/* ---------- 매장 설정 ---------- */
function saveSettings(obj) {
  guard_();
  const sh = sh_(SETTING), v = sh.getDataRange().getDisplayValues();
  SETTING_KEYS.forEach(k => {
    if (!obj || !(k in obj)) return;
    const val = cell_(obj[k], 120);
    const i = v.findIndex(r => String(r[0] || '').replace(/\s/g, '') === k);
    if (i >= 0) sh.getRange(i + 1, 2).setValue(val);
    else { sh.appendRow([k, val, '']); v.push([k, val, '']); }
  });
  return true;
}
