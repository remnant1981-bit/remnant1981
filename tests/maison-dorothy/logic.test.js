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

test('changeQty: 증가·감소·0이면 삭제·최대 9', () => {
  let c = L.addLine([], A, '블랙', '프리');
  c = L.changeQty(c, 0, 1);
  assert.equal(c[0].q, 2);
  c = L.changeQty(c, 0, 20);
  assert.equal(c[0].q, 9);
  c = L.changeQty(c, 0, -9);
  assert.equal(c.length, 0);
  assert.deepEqual(L.changeQty([], 3, 1), []);
});

test('freeShipLeft: 남은 금액, 가격 문의 섞이면 0', () => {
  const c = L.addLine([], A, '블랙', '프리');
  assert.equal(L.freeShipLeft(c, SHIP), 40000);
  assert.equal(L.freeShipLeft(L.addLine(L.addLine(c, B, '', ''), A, '블랙', '프리'), SHIP), 0);
  assert.equal(L.freeShipLeft(L.addLine(c, Q, '', ''), SHIP), 0);
  assert.equal(L.freeShipLeft([], SHIP), 0);
});

test('formatPhone: 휴대폰·서울·자리수 초과', () => {
  assert.equal(L.formatPhone('01012345678'), '010-1234-5678');
  assert.equal(L.formatPhone('010-123'), '010-123');
  assert.equal(L.formatPhone('0411234567'), '041-123-4567');
  assert.equal(L.formatPhone('0212345678'), '02-1234-5678');
  assert.equal(L.formatPhone('021234567'), '02-123-4567');
  assert.equal(L.formatPhone('010123456789999'), '010-1234-5678');
  assert.equal(L.isPhone(L.formatPhone('01012345678')), true);
});

test('openStatus: 영업 중·오픈 전·마감 후·일요일 휴무', () => {
  const S = { days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '20:00' };
  assert.equal(L.openStatus(new Date(2026, 10, 13, 14, 0), S).open, true);              // 금 14시
  assert.match(L.openStatus(new Date(2026, 10, 13, 9, 0), S).text, /오늘 10:00 오픈/);   // 금 9시
  assert.match(L.openStatus(new Date(2026, 10, 13, 20, 0), S).text, /내일 10:00/);       // 금 20시
  assert.match(L.openStatus(new Date(2026, 10, 14, 21, 0), S).text, /월요일 10:00/);     // 토 21시 → 일 휴무
  assert.match(L.openStatus(new Date(2026, 10, 15, 12, 0), S).text, /내일 10:00/);       // 일 12시
});

test('normalizeImg: 파일명·https·드라이브 링크 허용, 위험한 값 거부', () => {
  assert.equal(L.normalizeImg('coat.jpg'), 'coat.jpg');
  assert.equal(L.normalizeImg('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(L.normalizeImg('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing'), 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMn&sz=w1000');
  assert.equal(L.normalizeImg('https://drive.google.com/open?id=1AbCdEfGhIjKlMn'), 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMn&sz=w1000');
  assert.equal(L.normalizeImg('http://example.com/a.jpg'), '');
  assert.equal(L.normalizeImg('javascript:alert(1)'), '');
  assert.equal(L.normalizeImg('x" onerror="alert(1).jpg'), '');
  assert.equal(L.normalizeImg('../secret.jpg'), '');
});

test('parseSheet: 머리줄 찾기, 숨김·빈 줄 제외, 값 정리', () => {
  const rows = [
    ['메종도로시 상품표'],
    ['노출', '아이디', '분류', '상품명', '가격', '배지', '사진', '추가사진', '컬러', '사이즈', '추천사이즈', '설명', '코디팁', '인스타링크', '함께입기', '품절'],
    ['Y', 'c1', '아우터', '울 코트', '89,000원', '신상', 'coat.jpg', 'https://a.com/1.jpg, https://a.com/2.jpg', '베이지, 블랙', '', '66~88', '설명', '팁', 'https://www.instagram.com/p/X/', 'c2, zz', 'N'],
    ['', 'c2', '하의', '청바지', '', '', 'jean.jpg', '', '', 'S/M/L', '', '', '', 'https://evil.com', 'c1', '품절'],
    ['N', 'c3', '상의', '숨긴 옷', '1000'],
    ['Y', '', '상의', '아이디 없는 옷', '20000'],
    ['Y', 'c1', '상의', '중복 아이디', '1'],
    ['Y', 'c5', '', '']
  ];
  const p = L.parseSheet(rows);
  assert.deepEqual(p.map(x => x.id), ['c1', 'c2', 'r6']);
  assert.equal(p[0].price, 89000);
  assert.equal(p[0].badge, 'NEW');
  assert.deepEqual(p[0].gallery, ['https://a.com/1.jpg', 'https://a.com/2.jpg']);
  assert.deepEqual(p[0].colors, ['베이지', '블랙']);
  assert.deepEqual(p[0].fit, [66, 88]);
  assert.deepEqual(p[0].pair, ['c2']);
  assert.equal(p[0].soldOut, false);
  assert.equal(p[1].price, null);
  assert.deepEqual(p[1].sizes, ['S', 'M', 'L']);
  assert.equal(p[1].post, '');
  assert.equal(p[1].soldOut, true);
  assert.equal(L.parseSheet([['아무거나']]), null);
  assert.equal(L.parseSheet(null), null);
});

test('parseDays: 범위·나열·매일·평일', () => {
  assert.deepEqual(L.parseDays('월~토'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(L.parseDays('월-금'), [1, 2, 3, 4, 5]);
  assert.deepEqual(L.parseDays('월, 수, 금'), [1, 3, 5]);
  assert.deepEqual(L.parseDays('토~월'), [0, 1, 6]);
  assert.deepEqual(L.parseDays('매일').length, 7);
  assert.deepEqual(L.parseDays('평일'), [1, 2, 3, 4, 5]);
  assert.equal(L.parseDays('아무때나'), null);
});

test('parseSettings: 올바른 값만 반영', () => {
  const s = L.parseSettings([
    ['항목', '값'], ['공지', '이번 주 일요일 정상 영업해요'], ['영업 시간 안내', '10:00–19:00 · 일요일 휴무'],
    ['영업요일', '월~토'], ['오픈', '10:00'], ['마감', '19:00'], ['전화', '010-1234-5678'],
    ['카톡채널', 'https://pf.kakao.com/_abc'], ['밴드', 'https://evil.com/x'], ['입금계좌', '농협 123-45-6789 (홍길동)']
  ]);
  assert.equal(s.notice, '이번 주 일요일 정상 영업해요');
  assert.equal(s.hours, '10:00–19:00 · 일요일 휴무');
  assert.deepEqual(s.open, { days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '19:00' });
  assert.equal(s.phone, '010-1234-5678');
  assert.equal(s.kakaoUrl, 'https://pf.kakao.com/_abc');
  assert.equal(s.bandUrl, undefined);
  assert.equal(s.bank, '농협 123-45-6789 (홍길동)');
  assert.equal(L.parseSettings([['오픈', '25:00'], ['마감', '9:00']]), null);
  assert.deepEqual(L.parseSettings([['공지', '']]), { notice: '' });
  assert.equal(L.parseSettings('x'), null);
});

test('parseSheet 재고: 숫자·빈칸·0(바로 품절)', () => {
  const H = ['노출', '아이디', '분류', '상품명', '가격', '품절', '재고'];
  const p = L.parseSheet([H, ['Y', 'a', '상의', 'A', '1000', 'N', '2'], ['Y', 'b', '상의', 'B', '1000', 'N', ''], ['Y', 'c', '상의', 'C', '1000', 'N', '0'], ['Y', 'd', '상의', 'D', '1000', 'N', '5벌']]);
  assert.deepEqual(p.map(x => x.stock), [2, null, 0, 5]);
  assert.deepEqual(p.map(x => x.soldOut), [false, false, true, false]);
});
