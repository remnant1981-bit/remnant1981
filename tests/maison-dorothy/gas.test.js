// 실행: node --test "tests/maison-dorothy/*.test.js"
// 공개 스크립트(order-apps-script.gs)와 관리자 스크립트(admin/Code.gs)를 가짜 시트 위에서 시험
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./gas-mock.js');
const L = require('../../maison-dorothy/logic.js');

function setup(opts) {
  const env = makeEnv(opts);
  const pub = env.load('order-apps-script.gs');
  const adm = env.load('admin/Code.gs');
  pub.setupSheets();
  return { env, pub, adm };
}
const post = (pub, body) => JSON.parse(pub.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const ORDER = { no: 'D1114-1000-01', name: '김도로시', phone: '010-5555-1212', pickup: false, address: '홍성군 청사로 1', memo: '키 160', items: [{ name: '조끼', color: '블랙', size: '평소 88', q: 1, price: null }], sub: 0, ship: null, all: null, text: '주문 내용' };

test('공개: 시트 준비하기 → 주문·상품·설정 탭', () => {
  const { env } = setup();
  assert.deepEqual([...env.sheets.keys()].sort(), ['상품', '설정', '주문']);
  assert.equal(env.sheets.get('설정').getRange(1, 1).getDisplayValues()[0][0], '항목');
});

test('공개: doGet 은 상품·설정만 보여주고 주문은 숨김', () => {
  const { pub } = setup();
  post(pub, ORDER);
  const out = JSON.parse(pub.doGet({}).text);
  assert.equal(out.ok, true);
  assert.ok(out.rows[0].includes('상품명'));
  assert.ok(out.settings.some(r => r[0] === '영업요일'));
  assert.doesNotMatch(JSON.stringify(out), /김도로시|010-5555-1212/);
});

test('공개: 주문 접수 → 시트 기록·메일, 수식 주입 차단, 스팸 무시', () => {
  const { env, pub } = setup();
  assert.equal(post(pub, ORDER).ok, true);
  assert.equal(post(pub, { ...ORDER, no: 'D2', name: '=IMPORTXML("http://x","//a")', memo: '+SUM(1)', address: '@evil' }).ok, true);
  assert.equal(post(pub, { ...ORDER, website: 'spam' }).ok, true);
  assert.equal(post(pub, { ...ORDER, name: '' }).ok, false);
  const rows = env.sheets.get('주문').getDataRange().getDisplayValues();
  assert.equal(rows.length, 3);   // 머리줄 + 2건 (스팸·빈 이름 제외)
  assert.equal(rows[1][2], '입금대기');
  assert.equal(rows[1][4], '010-5555-1212');
  assert.equal(rows[2][3], '=IMPORTXML("http://x","//a")');   // 글자로 남음(수식 아님)
  assert.equal(rows[2][11], '+SUM(1)');
  assert.doesNotMatch(JSON.stringify(rows), /#수식실행됨/);
  assert.equal(env.mails.length, 2);
});

test('관리자: 본인 계정이 아니면 막힘', () => {
  for (const active of ['', 'other@example.com']) {
    const { adm } = setup({ active });
    assert.throws(() => adm.loadAll(), /관리자 계정으로만/);
    assert.throws(() => adm.saveProduct({ name: 'x' }), /관리자 계정으로만/);
  }
});

test('관리자: 불러오기 — 최신 주문이 위로', () => {
  const { pub, adm } = setup();
  post(pub, ORDER); post(pub, { ...ORDER, no: 'D2', name: '이손님' });
  const d = adm.loadAll();
  assert.deepEqual(d.orders.map(o => o.no), ['D2', 'D1114-1000-01']);
  assert.equal(d.orders[0].status, '입금대기');
  assert.equal(d.orders[1].phone, '010-5555-1212');
  assert.equal(d.settings['영업요일'], '월~토');
  assert.equal(d.me, 'owner@example.com');
});

test('관리자: 주문 상태·입금액·송장', () => {
  const { env, pub, adm } = setup();
  post(pub, ORDER);
  adm.updateOrder(ORDER.no, { all: '45,500원' });
  adm.updateOrder(ORDER.no, { status: '입금확인' });
  adm.updateOrder(ORDER.no, { status: '발송완료', tracking: '1234-5678-9012' });
  assert.throws(() => adm.updateOrder(ORDER.no, { status: '없는상태' }), /알 수 없는 상태/);
  assert.throws(() => adm.updateOrder('없는번호', { status: '취소' }), /찾을 수 없어요/);
  const o = adm.loadAll().orders[0];
  assert.equal(o.all, '45500');
  assert.equal(o.status, '발송완료');
  assert.equal(o.tracking, '1234-5678-9012');
  adm.updateOrder(ORDER.no, { note: '=HYPERLINK("x")' });
  assert.equal(adm.loadAll().orders[0].note, '=HYPERLINK("x")');
  assert.doesNotMatch(JSON.stringify(env.sheets.get('주문').getDataRange().getDisplayValues()), /#수식실행됨/);
});

test('관리자: 상품 추가(맨 위)·수정·품절·숨김·순서·삭제', () => {
  const { env, adm } = setup();
  const sh = env.sheets.get('상품');
  const id1 = adm.saveProduct({ name: '울 코트', price: '89,000', cat: '아우터', badge: 'NEW', img: 'https://drive.google.com/file/d/ABCDEFGHIJK/view', colors: '베이지, 블랙', fit: '66~88', show: true, soldOut: false });
  const id2 = adm.saveProduct({ name: '=수식 상품명', price: '', cat: '하의', show: true, soldOut: false });
  assert.match(id1, /^p[a-z0-9]+$/);
  let ps = adm.loadAll().products;
  assert.deepEqual(ps.map(p => p.name), ['=수식 상품명', '울 코트', '예시) 울 롱코트']);   // 새 상품이 맨 위
  assert.equal(ps[1].price, '89000');
  adm.saveProduct({ ...ps[1], id: id1, price: '79000', show: true, soldOut: false });
  adm.setProductFlag(id1, 'soldOut', true);
  adm.setProductFlag(id2, 'show', false);
  assert.throws(() => adm.setProductFlag(id1, 'price', true), /바꿀 수 없는/);
  adm.moveProduct(id1, 'up');
  ps = adm.loadAll().products;
  assert.deepEqual(ps.map(p => p.id).slice(0, 2), [id1, id2]);
  assert.equal(ps[0].price, '79000');
  assert.equal(ps[0].soldOut, 'Y');
  assert.equal(ps[1].show, 'N');
  adm.moveProduct('p20', 'top');
  assert.equal(adm.loadAll().products[0].id, 'p20');
  assert.equal(adm.moveProduct('p20', 'up'), false);
  adm.deleteProduct('p20');
  assert.deepEqual(adm.loadAll().products.map(p => p.id), [id1, id2]);
  assert.throws(() => adm.saveProduct({ name: '' }), /상품명/);
  assert.throws(() => adm.saveProduct({ name: 'x', id: '한글아이디' }), /영문·숫자/);
  assert.doesNotMatch(JSON.stringify(sh.getDataRange().getDisplayValues()), /#수식실행됨/);
});

test('관리자: 사진 올리기 → 드라이브 폴더, 링크 공유, 잘못된 파일 거부', () => {
  const { env, adm } = setup();
  const png = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
  const url = adm.uploadPhoto(png, '내 사진 1.png');
  assert.match(url, /^https:\/\/drive\.google\.com\/file\/d\/FILE1\w+\/view$/);
  assert.deepEqual(env.files[0].sharing, ['anyone', 'view']);
  assert.equal(env.files[0].blob.name, '_____1.png');
  adm.uploadPhoto(png, 'b.png');
  assert.equal(env.files.length, 2);
  assert.throws(() => adm.uploadPhoto('data:text/html;base64,PGI+', 'x.html'), /사진 파일/);
  assert.throws(() => adm.uploadPhoto('javascript:alert(1)', 'x'), /사진 파일/);
  assert.equal(L.normalizeImg(url), 'https://drive.google.com/thumbnail?id=FILE1abcdefghij&sz=w1000');
});

test('관리자: 매장 설정 저장 → 공개 페이지가 읽는 값으로 반영', () => {
  const { pub, adm } = setup();
  adm.saveSettings({ 공지: '내일은 쉬어요', 영업요일: '화~일', 오픈: '11:00', 마감: '19:00', 전화: '010-9999-8888', 입금계좌: '농협 1-2-3', 없는항목: 'x' });
  adm.saveProduct({ name: '니트', price: '39000', cat: '상의', img: 'https://drive.google.com/file/d/ABCDEFGHIJK/view', show: true, soldOut: false });
  const out = JSON.parse(pub.doGet({}).text);
  const s = L.parseSettings(out.settings);
  assert.equal(s.notice, '내일은 쉬어요');
  assert.deepEqual(s.open, { days: [0, 2, 3, 4, 5, 6], from: '11:00', to: '19:00' });
  assert.equal(s.phone, '010-9999-8888');
  assert.equal(s.bank, '농협 1-2-3');
  const ps = L.parseSheet(out.rows);
  assert.deepEqual(ps.map(p => p.name), ['니트']);            // 예시 상품(노출 N)은 숨김
  assert.equal(ps[0].price, 39000);
  assert.equal(ps[0].img, 'https://drive.google.com/thumbnail?id=ABCDEFGHIJK&sz=w1000');
});
