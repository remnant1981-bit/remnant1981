// 실행: node --test "tests/maison-dorothy/*.test.js"   (Node 18+, 의존성 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../maison-dorothy/logic.js');

const SHIP = { fee: 3500, freeOver: 70000 };
const A = { id: 'a', name: '조끼', price: 30000 };
const B = { id: 'b', name: '원피스', price: 45000 };
const Q = { id: 'q', name: '가디건', price: null };

test('addLine: 같은 상품·컬러·사이즈는 수량 증가, 원본 불변, 가격 없으면 null', () => {
  const c0 = [];
  const c1 = L.addLine(c0, A, '블랙', '프리');
  const c2 = L.addLine(c1, A, '블랙', '프리');
  const c3 = L.addLine(c2, A, '카멜', '프리');
  assert.equal(c0.length, 0);
  assert.equal(c2.length, 1);
  assert.equal(c2[0].q, 2);
  assert.equal(c3.length, 2);
  assert.equal(L.addLine([], Q, '', '평소 88')[0].price, null);
});

test('removeOne: 수량 감소 후 0이면 줄 삭제, 범위 밖은 무시', () => {
  let c = L.addLine(L.addLine([], A, '블랙', '프리'), A, '블랙', '프리');
  c = L.removeOne(c, 0);
  assert.equal(c[0].q, 1);
  c = L.removeOne(c, 0);
  assert.equal(c.length, 0);
  assert.deepEqual(L.removeOne(c, 5), []);
});

test('totals: 택배비·무료배송 기준·픽업', () => {
  const one = L.addLine([], A, '블랙', '프리');
  assert.deepEqual(L.totals(one, SHIP, false), { sub: 30000, ship: 3500, all: 33500, count: 1, unpriced: 0 });
  assert.equal(L.totals(one, SHIP, true).ship, 0);
  const free = L.addLine(L.addLine([], A, '블랙', '프리'), B, '올리브', '88');
  assert.equal(L.totals(free, SHIP, false).ship, 0);
  assert.equal(L.totals([], SHIP, false).all, 0);
});

test('totals: 가격 문의 상품이 섞이면 입금액·택배비는 확인 후 안내(null), 픽업 택배비는 0', () => {
  const mix = L.addLine(L.addLine([], A, '블랙', '프리'), Q, '', '평소 88');
  const t = L.totals(mix, SHIP, false);
  assert.equal(t.unpriced, 1);
  assert.equal(t.sub, 30000);
  assert.equal(t.all, null);
  assert.equal(t.ship, null);
  assert.equal(L.totals(mix, SHIP, true).ship, 0);
});

test('priceLabel·hasPrice', () => {
  assert.equal(L.priceLabel(A), '30,000원');
  assert.equal(L.priceLabel(Q), '가격 문의');
  assert.equal(L.hasPrice({ price: 0 }), false);
});

test('sizeOptions·fitLabel·fitsSize: 정해진 사이즈 / 추천 범위 / 미정', () => {
  assert.deepEqual(L.sizeOptions({ sizes: ['S', 'M', 'L'] }), { label: '사이즈', values: ['S', 'M', 'L'] });
  assert.deepEqual(L.sizeOptions({ fit: [66, 88] }).values, ['평소 66', '평소 77', '평소 88']);
  assert.equal(L.sizeOptions({}).values.length, 4);
  assert.equal(L.fitLabel({ fit: [66, 99] }), '66~99 추천');
  assert.equal(L.fitLabel({ sizes: ['S', 'M'] }), 'S · M');
  assert.equal(L.fitLabel({}), '사이즈 상담');
  assert.equal(L.fitsSize({ fit: [66, 88] }, 99), false);
  assert.equal(L.fitsSize({ fit: [66, 88] }, 88), true);
  assert.equal(L.fitsSize({}, 99), true);
  assert.equal(L.fitsSize({ fit: [66, 88] }, 0), true);
});

test('validate: 필수 항목과 픽업 시 주소 생략', () => {
  const ok = { name: '김도로시', phone: '010-1234-5678', pickup: false, address: '내포', agree: true };
  assert.deepEqual(L.validate(ok), []);
  assert.deepEqual(L.validate({ ...ok, pickup: true, address: '' }), []);
  assert.deepEqual(L.validate({ ...ok, phone: '1234' }), ['연락처']);
  assert.deepEqual(L.validate({ ...ok, agree: false }), ['개인정보 수집 동의']);
  assert.deepEqual(L.validate({}), ['성함', '연락처', '배송 주소', '개인정보 수집 동의']);
});

test('orderNo·orderText: 형식, 가격 문의 표기, 빈 컬러 생략', () => {
  assert.equal(L.orderNo(new Date(2026, 10, 13, 9, 5), 0.07), 'D1113-0905-07');
  const c = L.addLine([], Q, '', '평소 88');
  const t = L.totals(c, SHIP, false);
  const txt = L.orderText('D1', c, t, { name: '김', phone: '010-1-1', pickup: false, address: '내포', memo: '' });
  assert.match(txt, /가디건 \(평소 88\) ×1 가격 문의/);
  assert.match(txt, /입금액: 확인 후 안내/);
  assert.match(txt, /주소: 내포/);
  assert.doesNotMatch(txt, /메모/);
});
