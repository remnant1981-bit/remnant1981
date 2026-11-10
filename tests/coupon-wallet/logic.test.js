// 실행: node --test tests/coupon-wallet   (Node 18+, 의존성 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const CW = require('../../coupon-wallet/logic.js');

const T = '2026-11-10';

test('isDate: 형식·달력 유효성', () => {
  assert.equal(CW.isDate('2026-11-10'), true);
  assert.equal(CW.isDate('2026-02-30'), false);
  assert.equal(CW.isDate('2026-13-01'), false);
  assert.equal(CW.isDate('26-11-10'), false);
  assert.equal(CW.isDate(''), false);
  assert.equal(CW.isDate(null), false);
});

test('dayDiff: 월·연 경계와 윤년', () => {
  assert.equal(CW.dayDiff('2026-11-10', '2026-11-10'), 0);
  assert.equal(CW.dayDiff('2026-11-10', '2026-11-13'), 3);
  assert.equal(CW.dayDiff('2026-11-10', '2026-11-09'), -1);
  assert.equal(CW.dayDiff('2026-12-31', '2027-01-01'), 1);
  assert.equal(CW.dayDiff('2028-02-28', '2028-03-01'), 2); // 윤년
  assert.equal(CW.dayDiff('2026-03-07', '2026-03-09'), 2);  // 서머타임 지역에서도 2일
});

test('couponStatus: 만료일 당일은 사용 가능, 다음 날부터 만료, 사용 완료 우선', () => {
  assert.equal(CW.couponStatus({ expires: T }, T), 'active');
  assert.equal(CW.couponStatus({ expires: '2026-11-09' }, T), 'expired');
  assert.equal(CW.couponStatus({ expires: '' }, T), 'active');
  assert.equal(CW.couponStatus({ expires: '2026-01-01', usedAt: '2026-01-01' }, T), 'used');
});

test('ddayLabel / ddayClass', () => {
  assert.equal(CW.ddayLabel(null), '기한 없음');
  assert.equal(CW.ddayLabel(0), 'D-DAY');
  assert.equal(CW.ddayLabel(5), 'D-5');
  assert.equal(CW.ddayLabel(-2), 'D+2');
  assert.equal(CW.ddayClass(1), 'bad');
  assert.equal(CW.ddayClass(7), 'warn');
  assert.equal(CW.ddayClass(8), '');
  assert.equal(CW.ddayClass(null), 'mute');
});

test('loyaltyState', () => {
  assert.equal(CW.loyaltyState({ current: 17, target: 17, deadline: '2020-01-01' }, T), 'done');
  assert.equal(CW.loyaltyState({ current: 3, target: 17, deadline: '2026-11-09' }, T), 'overdue');
  assert.equal(CW.loyaltyState({ current: 3, target: 17, deadline: T }, T), 'active');
  assert.equal(CW.loyaltyState({ current: 3, target: 17, deadline: '' }, T), 'active');
});

test('pace: 달성·마감 없음·마감 지남·불가능·단기·장기', () => {
  assert.match(CW.pace({ current: 17, target: 17, deadline: '' }, T).text, /달성/);
  assert.equal(CW.pace({ current: 267, target: 300, deadline: '' }, T).text, '33 남음');
  assert.equal(CW.pace({ current: 1, target: 5, deadline: '2026-11-09' }, T).cls, 'bad');
  // 오늘 포함 3일(D-2) 동안 5개 → 하루 1개로도 부족
  assert.match(CW.pace({ current: 0, target: 5, deadline: '2026-11-12' }, T).text, /하루 1개로도 부족/);
  assert.equal(CW.pace({ current: 0, target: 5, deadline: '2026-11-12' }, T).cls, 'bad');
  // 단기(7일 이하)는 하루 단위
  assert.match(CW.pace({ current: 0, target: 3, deadline: '2026-11-15' }, T).text, /하루 0\.5개/);
  // 장기는 주 단위: 61일 남음(62일 가용), 11개 → 주 1.2개
  const p = CW.pace({ current: 6, target: 17, deadline: '2027-01-10' }, T);
  assert.match(p.text, /주 1\.2개 필요/);
  assert.equal(p.cls, '');
  // 마감 당일에 1개가 남았으면 가능하지만 촉박하므로 경고
  const last = CW.pace({ current: 4, target: 5, deadline: T }, T);
  assert.equal(last.cls, 'warn');
  assert.match(last.text, /D-0 · 1 남음 · 하루 1\.0개/);
});

test('stats: 이번 달 절약·놓침, 누적, 사용률', () => {
  const data = {
    coupons: [
      { usedAt: '2026-11-02', saved: 4000 },
      { usedAt: '2026-10-30', saved: 1000 },
      { expires: '2026-11-05', value: 3000 },            // 이번 달 만료
      { expires: '2026-10-31', value: 2000 },            // 지난달 만료
      { expires: '2026-12-01', value: 9999 },            // 사용 가능
      { expires: '' }
    ], loyalty: []
  };
  assert.deepEqual(CW.stats(data, T), { active: 2, saved: 4000, missed: 3000, total: 5000, rate: 50 });
  assert.equal(CW.stats({ coupons: [], loyalty: [] }, T).rate, null);
});

test('notifyLines: 쿠폰 D-3 이내와 적립 마감 D-7 이내만', () => {
  const data = {
    coupons: [
      { brand: 'A', title: '3일', expires: '2026-11-13' },
      { brand: 'B', title: '4일', expires: '2026-11-14' },
      { brand: 'C', title: '만료', expires: '2026-11-09' },
      { brand: 'D', title: '사용', expires: '2026-11-11', usedAt: '2026-11-10' },
      { brand: 'E', title: '무기한', expires: '' }
    ],
    loyalty: [
      { brand: 'S', name: '프리퀀시', current: 5, target: 17, deadline: '2026-11-17' },
      { brand: 'S', name: '먼 마감', current: 5, target: 17, deadline: '2026-11-18' },
      { brand: 'S', name: '달성', current: 17, target: 17, deadline: '2026-11-11' }
    ]
  };
  const lines = CW.notifyLines(data, T);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^A 3일 \(D-3\)$/);
  assert.match(lines[1], /S 프리퀀시 마감 D-7 \(5\/17\)/);
});

test('wonCompact / won', () => {
  assert.equal(CW.won(1234567), '1,234,567원');
  assert.equal(CW.wonCompact(0), '0원');
  assert.equal(CW.wonCompact(9999), '9,999원');
  assert.equal(CW.wonCompact(12345), '1.2만원');
  assert.equal(CW.wonCompact(100000), '10만원');
  assert.equal(CW.wonCompact(1234567), '123만원');
  assert.equal(CW.wonCompact(NaN), '0원');
});

test('normalizeCoupon: 필수값·형식 보정·위험 입력 제거', () => {
  assert.equal(CW.normalizeCoupon({ brand: '', title: 'x' }), null);
  assert.equal(CW.normalizeCoupon(null), null);
  const c = CW.normalizeCoupon({ brand: ' CU ', title: '상품권', value: '3000.7', expires: '2026-02-30', code: 123, image: 'https://evil.example/x.png', usedAt: 'bad' });
  assert.equal(c.brand, 'CU');
  assert.equal(c.value, 3001);
  assert.equal(c.expires, '');     // 달력상 없는 날짜는 제거
  assert.equal(c.code, '123');
  assert.equal(c.image, '');       // 외부 URL 이미지 거부
  assert.ok(c.id);
  assert.equal('usedAt' in c, false);
  const ok = CW.normalizeCoupon({ brand: 'a', title: 'b', image: 'data:image/png;base64,iVBORw0KGgo=', usedAt: '2026-11-01', saved: '500' });
  assert.equal(ok.image, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(ok.saved, 500);
  assert.equal(CW.normalizeCoupon({ brand: 'a', title: 'b', image: 'data:image/svg+xml;base64,AAAA' }).image, ''); // svg 거부
  assert.equal(CW.normalizeCoupon({ brand: 'a', title: 'b', value: -5 }).value, 0);
});

test('normalizeLoyalty: 목표 최소 1, 음수·NaN 보정', () => {
  const l = CW.normalizeLoyalty({ brand: 'S', name: 'n', current: '-3', target: 'x' });
  assert.equal(l.current, 0);
  assert.equal(l.target, 1);
  assert.equal(CW.normalizeLoyalty({ brand: 'S', name: '' }), null);
  assert.equal(CW.normalizeLoyalty({ brand: 'S', name: 'n', current: 2.9, target: 5.5 }).current, 2);
});

test('normalizeBackup: 구조 검증과 폐기 개수', () => {
  assert.equal(CW.normalizeBackup(null), null);
  assert.equal(CW.normalizeBackup({ coupons: [] }), null);
  assert.equal(CW.normalizeBackup('x'), null);
  const r = CW.normalizeBackup({
    coupons: [{ brand: 'a', title: 'b' }, { brand: '', title: 'x' }, 5],
    loyalty: [{ brand: 'a', name: 'b', target: 3 }, {}]
  });
  assert.equal(r.coupons.length, 1);
  assert.equal(r.loyalty.length, 1);
  assert.equal(r.dropped, 3);
  // 구버전(v1.0) 백업 형식도 수용
  const legacy = CW.normalizeBackup({ coupons: [], loyalty: [], lastNotify: '' });
  assert.deepEqual(legacy, { coupons: [], loyalty: [], dropped: 0 });
});

test('uid: 충돌 없음', () => {
  const s = new Set(Array.from({ length: 5000 }, () => CW.uid()));
  assert.equal(s.size, 5000);
});
