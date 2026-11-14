// 예시 줄 · 자동/직접 입력 칸 표시
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, styleLog } = require('./gas-mock.js');
const L = require('../../maison-dorothy/logic.js');

function setup() {
  const env = makeEnv();
  const pub = env.load('order-apps-script.gs');
  const adm = env.load('admin/Code.gs');
  pub.setupSheets();
  return { env, pub, adm };
}
const rowsOf = (env, n) => env.sheets.get(n).getDataRange().getDisplayValues();

test('예시 넣기: 주문·상품에 예시 줄 1개씩, 다시 눌러도 늘지 않음', () => {
  const { env, pub } = setup();
  pub.removeExamples();                                          // 새 시트의 기본 예시도 정리하고 시작
  pub.insertExamples(); pub.insertExamples();
  const o = rowsOf(env, '주문'), p = rowsOf(env, '상품');
  const ex = o.slice(1).filter(r => r[o[0].indexOf('주문번호')] === 'EX-0001');
  assert.equal(ex.length, 1);
  assert.match(ex[0][o[0].indexOf('받는분')], /^예시\)/);
  assert.equal(ex[0][o[0].indexOf('상태')], '입금대기');
  const pe = p.slice(1).filter(r => r[p[0].indexOf('아이디')] === 'ex-sample');
  assert.equal(pe.length, 1);
  assert.match(pe[0][p[0].indexOf('상품명')], /^예시\)/);
  assert.equal(pe[0][p[0].indexOf('노출')], 'N');
  assert.equal(pe[0][p[0].indexOf('재고')], '3');
});

test('예시는 손님 화면·관리자 주문 목록·요약 메일·현황·고객/인기상품 계산에서 빠짐', () => {
  const { env, pub, adm } = setup();
  pub.insertExamples();
  const out = JSON.parse(pub.doGet({}).text);
  assert.ok(!L.parseSheet(out.rows) || !L.parseSheet(out.rows).some(x => /^예시/.test(x.name)));   // 손님 화면에 없음
  assert.equal(adm.loadAll().orders.length, 0);                                                    // 관리자 주문 목록에 없음
  env.clock.weekday = 3;
  assert.equal(pub.dailyJob().sent, false);                                                        // 예시만 있으면 메일 안 감
  const dash = env.sheets.get('현황').getDataRange().getValues().flat().join('|');
  assert.ok((dash.match(/"<>EX-\*"/g) || []).length >= 5);                                         // 현황 수식 5개 모두 예시 제외
  const r = pub.buildInsights();
  assert.equal(r.customers, 0);
  const c = rowsOf(env, '고객');
  assert.match(c[1][0] + c[0][0], /예시/);                                                         // 안내 문구에 예시 표시
  assert.match(c[2][1], /^예시\) 홍길동/);                                                         // 주문이 없으면 예시 손님 1줄
  const b = rowsOf(env, '인기상품');
  assert.ok(!b.some(row => row.includes('예시) 니트 후드 가디건')));                                // 예시 주문은 판매량에 안 들어감
});

test('실제 주문이 생기면 고객 탭의 예시 손님은 사라지고, 예시 지우기로 예시 줄 삭제', () => {
  const { env, pub, adm } = setup();
  pub.insertExamples();
  pub.doPost({ postData: { contents: JSON.stringify({ no: 'D1', name: '진짜손님', phone: '010-1234-5678', pickup: true, items: [{ name: '니트', color: '', size: '평소 77', q: 1, price: 10000 }], sub: 10000, ship: 0, all: 10000, text: 'x' }) } });
  adm.updateOrder('D1', { status: '입금확인' });
  pub.buildInsights();
  const c = rowsOf(env, '고객');
  assert.equal(c.length, 3);
  assert.equal(c[2][1], '진짜손님');
  pub.removeExamples();
  const o = rowsOf(env, '주문'), p = rowsOf(env, '상품');
  assert.ok(!o.some(r => r.includes('EX-0001')));
  assert.ok(!p.some(r => r.includes('ex-sample')));
  assert.ok(o.some(r => r.includes('D1')));                                                       // 실제 주문은 그대로
});

test('칸 표시: 머리줄 메모(자동/직접 입력)와 예시 줄 강조 규칙', () => {
  const { pub } = setup();
  styleLog.length = 0;
  pub.styleSheets();
  const notes = styleLog.filter(x => /setNote/.test(x)).length;
  assert.ok(notes >= 15 + 17 + 3, `메모 ${notes}개`);                                              // 주문 15칸 + 상품 17칸 + 설정 3칸 (+ 계산 탭)
  assert.ok(styleLog.some(x => /Rule\.setItalic/.test(x)));                                        // 예시 줄 기울임 강조
});
