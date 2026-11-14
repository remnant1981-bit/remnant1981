// 고객 · 인기상품 · 재고 · 드롭다운 · 소식 수신 동의
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, styleLog } = require('./gas-mock.js');

const DAY = 86400000;
function setup() {
  const env = makeEnv();
  const pub = env.load('order-apps-script.gs');
  const adm = env.load('admin/Code.gs');
  pub.setupSheets();
  return { env, pub, adm };
}
const post = (pub, body) => JSON.parse(pub.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const ORDER = { no: 'D1', name: '김손님', phone: '010-1111-2222', pickup: false, address: '홍성', memo: '', items: [{ name: '니트 후드 가디건', color: '아이보리', size: '평소 77', q: 1, price: 52000 }], sub: 52000, ship: 3500, all: 55500, text: '주문' };
const table = (env, name) => { const v = env.sheets.get(name).getDataRange().getDisplayValues(); const h = v[1]; return v.slice(2).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
function order(env, { daysAgo, status, no, name, phone, method = '택배', all, items, ad = 'N' }) {
  const sh = env.sheets.get('주문');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const v = { 접수시각: new Date(Date.now() - daysAgo * DAY), 주문번호: no, 상태: status, 받는분: name, 연락처: "'" + phone, 받는방법: method, 상품: items, 입금액: all, 소식수신: ad };
  sh.appendRow(head.map(h => (h in v ? v[h] : '')));
}

test('주문 접수: 소식 수신 동의 저장, 예전 시트(소식수신 칸 없음)도 칸을 만들어 저장', () => {
  const env = makeEnv();
  const o = env.ss.insertSheet('주문');
  o.appendRow(['접수시각', '주문번호', '상태', '받는분', '연락처', '받는방법', '주소', '상품', '상품금액', '택배비', '입금액', '메모', '송장번호', '관리메모']);   // 예전 머리줄
  const pub = env.load('order-apps-script.gs');
  assert.equal(post(pub, { ...ORDER, ad: true }).ok, true);
  assert.equal(post(pub, { ...ORDER, no: 'D2' }).ok, true);
  const v = o.getDataRange().getDisplayValues();
  const i = v[0].indexOf('소식수신');
  assert.ok(i > 0);
  assert.equal(v[1][i], 'Y');
  assert.equal(v[2][i], 'N');
  assert.equal(v[1][v[0].indexOf('받는분')], '김손님');        // 다른 칸도 이름에 맞게
  assert.equal(v[1][v[0].indexOf('입금액')], '55500');
});

test('드롭다운: 주문(상태·받는방법·소식수신), 상품(노출·품절·분류·배지·추천사이즈·재고)', () => {
  const { pub } = setup();
  styleLog.length = 0;
  pub.styleSheets();
  const dv = styleLog.filter(x => /setDataValidation/.test(x)).length;
  assert.ok(dv >= 9, `드롭다운 ${dv}개`);
});

test('인기상품: 최근 30일 순위, 사이즈·컬러, 재고 기반 다시 들여오기, 안 팔리는 옷 홍보', () => {
  const { env, pub, adm } = setup();
  adm.saveProduct({ id: 'k1', name: '니트 후드 가디건', price: '52000', cat: '아우터', show: true, soldOut: false });
  adm.saveProduct({ id: 'k2', name: '숏 퀼팅 조끼', price: '35000', cat: '조끼', show: true, soldOut: false });
  adm.saveProduct({ id: 'k3', name: '기모 스판 데님', price: '', cat: '하의', show: true, soldOut: false });
  const ph = env.sheets.get('상품'); const sc = ph.getRange(1, 1, 1, ph.getLastColumn()).getDisplayValues()[0].indexOf('재고') + 1;
  const rowOf = n => ph.getDataRange().getDisplayValues().findIndex(r => r.includes(n)) + 1;
  ph.getRange(rowOf('니트 후드 가디건'), sc).setValue(2);
  ph.getRange(rowOf('숏 퀼팅 조끼'), sc).setValue(0);
  order(env, { daysAgo: 1, status: '입금확인', no: 'A', name: '가', phone: '010-1', all: 104000, items: '니트 후드 가디건(아이보리/평소 77)×2' });
  order(env, { daysAgo: 5, status: '발송완료', no: 'B', name: '나', phone: '010-2', all: 52000, items: '니트 후드 가디건(그레이/평소 88)×1\n숏 퀼팅 조끼(네이비/평소 88)×1' });
  order(env, { daysAgo: 40, status: '발송완료', no: 'C', name: '다', phone: '010-3', all: 35000, items: '숏 퀼팅 조끼(네이비/평소 77)×3' });
  order(env, { daysAgo: 2, status: '취소', no: 'X', name: '라', phone: '010-4', all: 0, items: '기모 스판 데님(M)×5' });
  const r = pub.buildInsights();
  const b = table(env, '인기상품');
  assert.equal(b[0]['상품명'], '니트 후드 가디건');
  assert.equal(b[0]['최근 30일'], '3');
  assert.equal(b[0]['많이 나간 사이즈'], '평소 77');
  assert.equal(b[0]['많이 나간 컬러'], '아이보리');
  assert.equal(b[0]['추천'], '다시 들여오기');                            // 잘 팔리는데 재고 2벌 → 들여오기가 우선
  const vest = b.find(x => x['상품명'] === '숏 퀼팅 조끼');
  assert.equal(vest['전체 판매'], '4');
  assert.equal(vest['최근 30일'], '1');
  assert.equal(vest['추천'], '다시 들여오기');                            // 재고 0 · 30일 판매 있음
  const denim = b.find(x => x['상품명'] === '기모 스판 데님');
  assert.equal(denim['전체 판매'], '0');                                  // 취소 주문은 빼고 셈
  assert.match(denim['추천'], /^홍보하기/);
  assert.deepEqual(r.restock.map(x => x.name).sort(), ['숏 퀼팅 조끼', '니트 후드 가디건'].sort());
  // 재고 0 → 아침 작업에서 자동 품절, 재고 비어 있는 옷은 건드리지 않음
  const before = adm.loadAll().products.find(p => p.name === '기모 스판 데님').soldOut;
  pub.dailyJob();
  const ps = adm.loadAll().products;
  assert.equal(ps.find(p => p.name === '숏 퀼팅 조끼').soldOut, 'Y');
  assert.equal(ps.find(p => p.name === '기모 스판 데님').soldOut, before);
  assert.match(env.mails.at(-1).body, /자동 품절 처리 1벌/);
  assert.match(env.mails.at(-1).body, /다시 들여올 옷/);
  assert.match(env.mails.at(-1).body, /최근 30일 인기 옷/);
});

test('고객: 연락처별 합치기, 등급, 평소 사이즈, 소식 수신·다시 연락해보기, 손으로 쓴 메모 유지', () => {
  const { env, pub, adm } = setup();
  adm.saveProduct({ id: 'k1', name: '니트 후드 가디건', price: '52000', cat: '아우터', show: true, soldOut: false });
  order(env, { daysAgo: 200, status: '발송완료', no: 'A1', name: '김단골', phone: '010-1111-2222', all: 150000, items: '니트 후드 가디건(아이보리/평소 88)×1' });
  order(env, { daysAgo: 100, status: '발송완료', no: 'A2', name: '김단골', phone: '01011112222', all: 160000, items: '니트 후드 가디건(그레이/평소 88)×1', ad: 'Y' });
  order(env, { daysAgo: 70, status: '픽업완료', no: 'A3', name: '김단골', phone: '010-1111-2222', method: '매장 픽업', all: 50000, items: '니트 후드 가디건(아이보리/평소 88)×1', ad: 'Y' });
  order(env, { daysAgo: 3, status: '입금대기', no: 'B1', name: '이신규', phone: '010-3333-4444', all: 0, items: '니트 후드 가디건(아이보리/평소 66)×1' });
  order(env, { daysAgo: 30, status: '입금확인', no: 'C1', name: '박두번', phone: '010-5555-6666', all: 40000, items: '니트 후드 가디건(아이보리/평소 77)×1', ad: 'Y' });
  order(env, { daysAgo: 10, status: '취소', no: 'C2', name: '박두번', phone: '010-5555-6666', all: 0, items: '니트 후드 가디건(아이보리/평소 77)×1' });
  order(env, { daysAgo: 9, status: '발송완료', no: 'C3', name: '박두번', phone: '010-5555-6666', all: 30000, items: '니트 후드 가디건(아이보리/평소 77)×1', ad: 'Y' });
  const r = pub.buildInsights();
  let c = table(env, '고객');
  assert.equal(c.length, 3);
  const kim = c[0];
  assert.equal(kim['이름'], '김단골');
  assert.equal(kim['주문 횟수'], '3');
  assert.equal(kim['누적 구매액'], '360000');                             // 30만 이상 → VIP
  assert.equal(kim['등급'], 'VIP');
  assert.equal(kim['평소 사이즈'], '88 사이즈');
  assert.equal(kim['자주 산 분류'], '아우터');
  assert.equal(kim['소식 수신'], 'Y');
  assert.equal(kim['마케팅'], '다시 연락해보기');                         // 동의 + 60일 넘음
  const park = c.find(x => x['이름'] === '박두번');
  assert.equal(park['주문 횟수'], '2');                                   // 취소 제외
  assert.equal(park['등급'], '단골');
  assert.equal(park['마케팅'], '');
  const lee = c.find(x => x['이름'] === '이신규');
  assert.equal(lee['등급'], '신규');
  assert.equal(lee['누적 구매액'], '0');                                  // 입금 전은 구매액에 안 넣음
  assert.equal(r.dormant, 1);
  // 손으로 쓴 메모는 다시 계산해도 유지
  const sh = env.sheets.get('고객');
  const head = sh.getRange(2, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  sh.getRange(3, head.indexOf('메모(직접 입력)') + 1).setValue('니트 좋아함, 11월 생일');
  pub.buildInsights();
  c = table(env, '고객');
  assert.equal(c[0]['메모(직접 입력)'], '니트 좋아함, 11월 생일');
  // 고객·인기상품은 공개 안 됨
  assert.doesNotMatch(pub.doGet({}).text, /김단골|010-1111|VIP/);
});

test('관리자 앱: 재고 칸 저장, 다른 칸은 그대로', () => {
  const { adm } = setup();
  const id = adm.saveProduct({ name: '울 코트', price: '89000', cat: '아우터', stock: '5', show: true, soldOut: false });
  let p = adm.loadAll().products.find(x => x.id === id);
  assert.equal(p.stock, '5');
  adm.saveProduct({ ...p, stock: '0', show: true, soldOut: false });
  p = adm.loadAll().products.find(x => x.id === id);
  assert.equal(p.stock, '0');
  assert.equal(p.price, '89000');
  adm.saveProduct({ ...p, stock: '', show: true, soldOut: false });
  assert.equal(adm.loadAll().products.find(x => x.id === id).stock, '');   // 비우면 재고 관리 안 함
});
