// 실행: node --test "tests/maison-dorothy/*.test.js"
// 공개 스크립트(order-apps-script.gs)와 관리자 스크립트(admin/Code.gs)를 가짜 시트 위에서 시험
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, styleLog } = require('./gas-mock.js');
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

test('공개: 시트 준비하기 → 현황·주문·상품·설정 탭', () => {
  const { env } = setup();
  assert.deepEqual([...env.sheets.keys()].sort(), ['고객', '상품', '설정', '인기상품', '주문', '현황']);
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
  assert.deepEqual(ps.map(p => p.name), ['=수식 상품명', '울 코트', '예시) 울 롱코트 (예시 줄)']);   // 새 상품이 맨 위
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
  adm.moveProduct('ex-sample', 'top');
  assert.equal(adm.loadAll().products[0].id, 'ex-sample');
  assert.equal(adm.moveProduct('ex-sample', 'up'), false);
  adm.deleteProduct('ex-sample');
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

test('공개: 보기 좋게 꾸미기 — 값은 그대로, 현황 탭 추가, 여러 번 실행해도 같음', () => {
  const { env, pub, adm } = setup();
  post(pub, ORDER);
  adm.saveProduct({ name: '니트', price: '39000', cat: '상의', show: true, soldOut: false });
  const snap = n => JSON.stringify(env.sheets.get(n).getDataRange().getDisplayValues());
  const before = { 주문: snap('주문'), 상품: snap('상품'), 설정: snap('설정'), get: pub.doGet({}).text, load: JSON.stringify(adm.loadAll()) };
  styleLog.length = 0;
  pub.styleSheets(); pub.styleSheets();
  assert.equal(snap('주문'), before.주문);
  assert.equal(snap('상품'), before.상품);
  assert.equal(snap('설정'), before.설정);
  assert.equal(pub.doGet({}).text, before.get);                 // 손님 페이지가 읽는 값 그대로
  assert.equal(JSON.stringify(adm.loadAll()), before.load);     // 관리자 앱이 읽는 값 그대로
  assert.ok(env.sheets.has('현황'));
  const dash = env.sheets.get('현황').getDataRange().getValues().flat().join('|');
  assert.match(dash, /입금 확인할 주문/);
  assert.match(dash, /=COUNTIFS\('주문'!C2:C,"입금대기",'주문'!B2:B,"<>EX-\*"\)/);   // 칸 이름으로 찾은 열(상태=C), 예시 주문 제외
  assert.match(dash, /'상품'!E2:E,""/);                         // 가격=E
  assert.equal(env.sheets.get('상품').bandings.length, 1);      // 줄무늬 중복 없이 1개
  assert.ok(env.sheets.get('주문').rules.length >= 4);          // 상태별 색
  assert.ok(styleLog.some(x => /setDataValidation/.test(x)));
  assert.doesNotMatch(pub.doGet({}).text, /현황|입금 확인할/);  // 현황 탭은 공개 안 됨
  // 꾸민 뒤에도 주문 접수·상품 수정 정상
  assert.equal(post(pub, { ...ORDER, no: 'D9' }).ok, true);
  adm.updateOrder('D9', { status: '입금확인' });
  assert.equal(adm.loadAll().orders[0].status, '입금확인');
});

test('공개: 시트 준비하기 → 빈 기본 탭(시트1·Sheet2)만 정리, 내용 있는 탭은 유지', () => {
  const env = makeEnv();
  env.ss.insertSheet('시트1');                                   // 빈 기본 탭
  env.ss.insertSheet('Sheet2');                                  // 빈 영문 기본 탭
  env.ss.insertSheet('시트3').appendRow(['훈이 메모']);          // 내용 있음 → 유지
  env.ss.insertSheet('메모');                                    // 기본 이름 아님 → 유지
  const pub = env.load('order-apps-script.gs');
  pub.setupSheets();
  assert.deepEqual([...env.sheets.keys()].sort(), ['고객', '메모', '상품', '설정', '시트3', '인기상품', '주문', '현황']);
  pub.setupSheets();                                             // 다시 눌러도 같음
  assert.equal(env.sheets.size, 8);
});

/* ---------- 자동화 ---------- */
const DAY = 86400000;
function addOrder(env, { daysAgo, status, no, name = '손님', method = '택배', all = 50000, items = '니트 후드 가디건(아이보리/평소 66)×1' }) {
  env.sheets.get('주문').appendRow([new Date(Date.now() - daysAgo * DAY), no, status, name, "'010-1111-2222", method, '주소', items, all, 0, all, '', '', '']);
}

test('자동화: 켜기·끄기 — 예약 2개, 여러 번 눌러도 중복 없음', () => {
  const { env, pub } = setup();
  pub.enableAutomation(); pub.enableAutomation();
  assert.deepEqual(env.triggers.map(t => t.getHandlerFunction()).sort(), ['dailyJob', 'weeklyBackup']);
  const daily = env.triggers.find(t => t.getHandlerFunction() === 'dailyJob').spec;
  assert.deepEqual(daily.atHour, [8]);
  assert.deepEqual(daily.inTimezone, ['Asia/Seoul']);
  pub.disableAutomation();
  assert.equal(env.triggers.length, 0);
});

test('자동화: 예전 설정 탭에 자동화 항목 추가(기존 값 유지)', () => {
  const env = makeEnv();
  const s = env.ss.insertSheet('설정');
  s.appendRow(['항목', '값', '설명']); s.appendRow(['입금계좌', '농협 1-2-3', '']);
  const pub = env.load('order-apps-script.gs');
  pub.setupSheets();
  const rows = s.getDataRange().getDisplayValues();
  assert.ok(rows.some(r => r[0] === '입금계좌' && r[1] === '농협 1-2-3'));
  assert.ok(['입금기한', '자동취소', '보관기간', '공지'].every(k => rows.some(r => r[0] === k)));
  pub.setupSheets();
  assert.equal(s.getDataRange().getDisplayValues().filter(r => r[0] === '입금기한').length, 1);
});

test('자동화: 아침 요약 — 입금기한 알림, 오래된 완료 주문 보관, 메일 내용', () => {
  const { env, pub, adm } = setup();
  env.clock.weekday = 3;   // 수요일
  addOrder(env, { daysAgo: 0.2, status: '입금대기', no: 'NEW', name: '새손님' });
  addOrder(env, { daysAgo: 3, status: '입금대기', no: 'LATE', name: '늦은손님' });
  addOrder(env, { daysAgo: 1.5, status: '입금확인', no: 'SHIP', name: '택배손님' });
  addOrder(env, { daysAgo: 2, status: '입금확인', no: 'PICK', name: '픽업손님', method: '매장 픽업' });
  addOrder(env, { daysAgo: 120, status: '발송완료', no: 'OLD1' });
  addOrder(env, { daysAgo: 100, status: '취소', no: 'OLD2' });
  addOrder(env, { daysAgo: 30, status: '발송완료', no: 'KEEP' });
  const r = pub.dailyJob();
  assert.equal(r.sent, true);
  const mail = env.mails.at(-1);
  assert.match(mail.subject, /입금확인 2 · 택배 1 · 새 주문 1/);
  assert.match(mail.body, /입금기한 지난 주문 1건/);
  assert.match(mail.body, /늦은손님 \(LATE\)/);
  assert.match(mail.body, /"보관" 탭으로 옮김/);
  assert.match(mail.body, /픽업 대기 1건/);
  const nos = adm.loadAll().orders.map(o => o.no);
  assert.deepEqual(nos.sort(), ['KEEP', 'LATE', 'NEW', 'PICK', 'SHIP']);           // 오래된 2건은 주문 탭에서 빠짐
  const arch = env.sheets.get('보관').getDataRange().getDisplayValues();
  assert.deepEqual(arch.slice(1).map(x => x[1]).sort(), ['OLD1', 'OLD2']);         // 보관 탭으로 이동
  assert.equal(arch[0][1], '주문번호');
  const late = adm.loadAll().orders.find(o => o.no === 'LATE');
  assert.equal(late.status, '입금대기');                                           // 자동취소 N: 상태 유지
  assert.equal(late.note, '입금기한 지남');
  pub.dailyJob();
  assert.equal(adm.loadAll().orders.find(o => o.no === 'LATE').note, '입금기한 지남');   // 메모 중복 없음
  assert.doesNotMatch(pub.doGet({}).text, /늦은손님|OLD1|LATE/);                    // 주문·보관 내용은 공개 안 됨
});

test('자동화: 자동취소 Y, 할 일 없는 날은 메일 안 보냄, 월요일은 주간 리포트', () => {
  const { env, pub, adm } = setup();
  env.clock.weekday = 3;
  adm.saveSettings({ 자동취소: 'Y', 입금기한: '1' });
  addOrder(env, { daysAgo: 1.2, status: '입금대기', no: 'LATE' });
  pub.dailyJob();
  const o = adm.loadAll().orders.find(x => x.no === 'LATE');
  assert.equal(o.status, '취소');
  assert.equal(o.note, '입금기한 지나 자동 취소');
  assert.match(env.mails.at(-1).body, /자동 취소함/);
  const { env: e2, pub: p2 } = setup();
  e2.clock.weekday = 4;
  assert.equal(p2.dailyJob().sent, false);                                       // 할 일 없음 → 안 보냄
  assert.equal(e2.mails.length, 0);
  e2.clock.weekday = 1;
  addOrder(e2, { daysAgo: 3, status: '발송완료', no: 'W1', items: '니트 후드 가디건(아이보리/평소 66)×2\n숏 퀼팅 조끼(네이비/평소 88)×1', all: 87000 });
  assert.equal(p2.dailyJob().sent, true);
  assert.match(e2.mails.at(-1).body, /지난주 리포트/);
  assert.match(e2.mails.at(-1).body, /입금 확인된 금액 87,000원/);
  assert.match(e2.mails.at(-1).body, /많이 주문된 옷: 니트 후드 가디건 2벌/);
});

test('자동화: 주간 백업 — 복사본 생성, 최근 8개만 남김', () => {
  const { env, pub } = setup();
  for (let i = 0; i < 10; i++) pub.weeklyBackup();
  assert.equal(env.copies.length, 10);
  assert.equal(env.copies.filter(c => !c.trashed).length, 8);
  assert.ok(env.copies.slice(0, 2).every(c => c.trashed));                          // 가장 오래된 2개가 휴지통
  assert.match(env.copies[0].name, /^메종도로시 운영 백업 \d{4}-\d{2}-\d{2}$/);
  assert.equal(env.folders.filter(f => f.name === '메종도로시 백업').length, 1);
});
