// 실행: node --test "tests/maison-dorothy/*.test.js"   (Node 18+, 의존성 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../maison-dorothy/logic.js');

const SHIP = { fee: 3500, freeOver: 70000 };
const A = { id: 'a', name: '조끼', price: 30000 };
const B = { id: 'b', name: '원피스', price: 45000 };

test('addLine: 같은 상품·컬러·사이즈는 수량 증가, 원본 불변', () => {
  const c0 = [];
  const c1 = L.addLine(c0, A, '블랙', '프리');
  const c2 = L.addLine(c1, A, '블랙', '프리');
  const c3 = L.addLine(c2, A, '카멜', '프리');
  assert.equal(c0.length, 0);
  assert.equal(c1[0].q, 1);
  assert.equal(c2.length, 1);
  assert.equal(c2[0].q, 2);
  assert.equal(c3.length, 2);
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
  assert.deepEqual(L.totals(one, SHIP, false), { sub: 30000, ship: 3500, all: 33500, count: 1 });
  assert.equal(L.totals(one, SHIP, true).ship, 0);
  const free = L.addLine(L.addLine([], A, '블랙', '프리'), B, '올리브', '88');
  assert.equal(L.totals(free, SHIP, false).sub, 75000);
  assert.equal(L.totals(free, SHIP, false).ship, 0);
  assert.equal(L.totals([], SHIP, false).all, 0);
});

test('validate: 필수 항목과 픽업 시 주소 생략', () => {
  const ok = { name: '김도로시', phone: '010-1234-5678', pickup: false, address: '내포', agree: true };
  assert.deepEqual(L.validate(ok), []);
  assert.deepEqual(L.validate({ ...ok, pickup: true, address: '' }), []);
  assert.deepEqual(L.validate({ ...ok, address: ' ' }), ['배송 주소']);
  assert.deepEqual(L.validate({ ...ok, phone: '1234' }), ['연락처']);
  assert.deepEqual(L.validate({ ...ok, agree: false }), ['개인정보 수집 동의']);
  assert.deepEqual(L.validate({}), ['성함', '연락처', '배송 주소', '개인정보 수집 동의']);
});

test('isPhone: 하이픈 유무', () => {
  assert.equal(L.isPhone('01012345678'), true);
  assert.equal(L.isPhone('041-123-4567'), true);
  assert.equal(L.isPhone('12345'), false);
});

test('orderNo·orderText: 형식과 픽업 시 주소 제외', () => {
  assert.equal(L.orderNo(new Date(2026, 10, 13, 9, 5), 0.07), 'D1113-0905-07');
  const c = L.addLine([], A, '블랙', '프리');
  const t = L.totals(c, SHIP, true);
  const txt = L.orderText('D1', c, t, { name: '김', phone: '010-1-1', pickup: true, address: '어딘가', memo: '' });
  assert.match(txt, /조끼 \(블랙\/프리\) ×1 30,000원/);
  assert.match(txt, /택배비: 무료/);
  assert.doesNotMatch(txt, /주소/);
  assert.doesNotMatch(txt, /메모/);
});
