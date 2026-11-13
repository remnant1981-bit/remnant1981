// 실행: node --test "tests/rnd-budget/*.test.js"   (Node 22+, 의존성 없음)
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const RB = require('../../rnd-budget/logic.js');

const base = (o = {}) => ({ ruleset: 'sme', gov: 300000, people: [], items: {}, ...o });

test('정부출연금 → 최소 총사업비·기관부담금·현금(중소 75%/10%)', () => {
  assert.deepEqual(RB.calcFunding(300000, 75, 10), { gov: 300000, total: 400000, org: 100000, cashMin: 10000, inkindMax: 90000 });
  assert.deepEqual(RB.calcFunding('100,000', 70, 13), { gov: 100000, total: 142858, org: 42858, cashMin: 5572, inkindMax: 37286 }); // 올림
  assert.equal(RB.calcFunding(0, 75, 10).total, 0);
  assert.equal(RB.calcFunding(1000, 0, 10).org, 0);
});

test('인건비 = 연봉/12 × 개월 × 참여율, 입력 정리', () => {
  assert.equal(RB.personCost({ salary: 60000, months: 12, rate: 50 }), 30000);
  assert.equal(RB.personCost({ salary: '48,000', months: 6, rate: '30%' }), 7200);
  assert.equal(RB.personCost({ salary: 60000, months: 15, rate: 150 }), 60000); // 12개월·100% 상한
  assert.equal(RB.personCost({ salary: -1, months: 12, rate: 50 }), 0);
});

test('편성 계산: 인건비 현금/현물 분리, 간접비 기준(직접비−현물−위탁)', () => {
  const r = RB.calcBudget(base({
    people: [{ name: 'A', salary: 60000, months: 12, rate: 50 }, { name: 'B', salary: 80000, months: 12, rate: 50, kind: 'existing' }],
    items: { material: { cash: 100000, inkind: 50000 }, outsource: { cash: 60000 }, activity: { cash: 20000 }, allowance: { cash: 5000 }, student: { cash: 10000, inkind: 999 } },
  }));
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.deepEqual([row('personnel').cash, row('personnel').inkind], [30000, 40000]);
  assert.equal(row('student'), undefined); // 영리기관은 학생인건비 비목 없음
  assert.equal(r.direct.total, 30000 + 40000 + 150000 + 60000 + 20000 + 5000);
  assert.equal(r.indirectBase, r.direct.total - 90000 - 60000);
  assert.equal(r.indirect, Math.floor(r.indirectBase * 0.1));
  assert.equal(r.total.total, r.direct.total + r.indirect);
});

test('점검: 총사업비 부족·현금 부족·연구수당 초과·참여율 초과', () => {
  const lv = (r) => r.checks.filter((c) => c.level === 'error').map((c) => c.msg).join('\n');
  // 총사업비 부족
  let r = RB.calcBudget(base({ items: { material: { cash: 300000 } } }));
  assert.match(lv(r), /최소 총사업비보다/);
  // 정확히 맞춘 정상 편성: 총 400,000 = 현금 310,000 + 현물 90,000
  const ok = base({ indirectPct: 0, people: [{ name: 'A', salary: 90000, months: 12, rate: 100, kind: 'existing' }], items: { material: { cash: 300000 }, activity: { cash: 10000 } } });
  r = RB.calcBudget(ok);
  assert.equal(r.total.total, 400000);
  assert.equal(lv(r), '');
  assert.ok(r.checks.some((c) => c.level === 'ok' && /현금 10,000/.test(c.msg)));
  // 기관 현금 부족(현물 과다)
  r = RB.calcBudget(base({ indirectPct: 0, people: [{ name: 'A', salary: 95000, months: 12, rate: 100, kind: 'existing' }], items: { material: { cash: 305000 } } }));
  assert.match(lv(r), /최소 10,000천원\(10%\)보다 5,000천원 부족/);
  // 정부출연금보다 현금이 적음
  r = RB.calcBudget(base({ indirectPct: 0, items: { material: { cash: 200000, inkind: 200000 } } }));
  assert.match(lv(r), /정부출연금보다 100,000천원 적습니다/);
  // 연구수당 20% 초과
  r = RB.calcBudget(base({ people: [{ name: 'A', salary: 50000, months: 12, rate: 100 }], items: { allowance: { cash: 10001 } } }));
  assert.match(lv(r), /연구수당 10,001천원이 한도 10,000천원/);
  // 참여율 합계 100% 초과
  r = RB.calcBudget(base({ people: [{ name: '홍길동', salary: 50000, months: 12, rate: 60, otherRate: 50 }], items: { material: { cash: 1 } } }));
  assert.match(lv(r), /홍길동: 총 참여율 110%/);
});

test('정부출연금 미입력 시 안내만', () => {
  const r = RB.calcBudget({});
  assert.equal(r.checks.length, 1);
  assert.equal(r.checks[0].level, 'info');
});

test('XLSX: 올바른 ZIP 구조·CRC·수식·한글', () => {
  const bytes = RB.buildXlsx(base({ title: '테스트', people: [{ name: '홍길동', salary: 60000, months: 12, rate: 50 }], items: { material: { cash: 100000 } } }), '테스트 <편성표>');
  const buf = Buffer.from(bytes);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  // 로컬 헤더를 따라가며 파일 목록·CRC 검증(무압축)
  const files = {}; let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const crc = buf.readUInt32LE(off + 14), size = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
    const data = buf.subarray(off + 30 + nlen, off + 30 + nlen + size);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : RB.crc32(data), crc, name);
    files[name] = data.toString('utf8');
    off += 30 + nlen + size;
  }
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  const s1 = files['xl/worksheets/sheet1.xml'];
  assert.match(s1, /테스트 &lt;편성표&gt;/); // XML 이스케이프
  assert.match(s1, /시행령 별표 1 제1호: 정부지원 75% 이하/); // 적용 기준·근거 포함
  assert.match(s1, /<f>SUM\(B9:B15\)<\/f>/);
  assert.match(s1, /<f>D16-B5<\/f>/); // 기관부담금 = 합계 − 정부출연금
  assert.match(files['xl/worksheets/sheet2.xml'], /홍길동.*신규 채용\(현금\).*<f>ROUND\(B5\/12\*C5\*D5\/100,0\)<\/f>/);
  assert.equal(RB.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('법령 기준 고정: 기관 유형별 비율·근거, 직접 입력 시에만 변경', () => {
  const eff = (o) => RB.effectiveRules(o);
  assert.deepEqual([eff({ ruleset: 'sme' }).govMaxPct, eff({ ruleset: 'sme' }).cashMinPct], [75, 10]);
  assert.deepEqual([eff({ ruleset: 'midS' }).govMaxPct, eff({ ruleset: 'midS' }).cashMinPct], [70, 10]); // 3천억 미만 중견 10%
  assert.deepEqual([eff({ ruleset: 'midL' }).govMaxPct, eff({ ruleset: 'midL' }).cashMinPct], [70, 13]);
  assert.deepEqual([eff({ ruleset: 'large' }).govMaxPct, eff({ ruleset: 'large' }).cashMinPct], [50, 15]);
  assert.deepEqual([eff({ ruleset: 'univ' }).indirectPct, eff({ ruleset: 'nonprofit' }).indirectPct], [5, 17]);
  // 법령 유형에서는 비율 입력값을 무시(고정), 간접비는 상한 내 조정만
  const f = eff({ ruleset: 'sme', govMaxPct: 90, cashMinPct: 1, allowanceMaxPct: 50, indirectPct: 30 });
  assert.deepEqual([f.govMaxPct, f.cashMinPct, f.allowancePct, f.indirectPct], [75, 10, 20, 10]);
  assert.equal(eff({ ruleset: 'sme', indirectPct: 7 }).indirectPct, 7);
  // 직접 입력
  const c = eff({ ruleset: 'custom', govMaxPct: 80, cashMinPct: 5, indirectPct: 12, allowanceMaxPct: 20 });
  assert.deepEqual([c.govMaxPct, c.cashMinPct, c.indirectPct], [80, 5, 12]);
  for (const k of Object.keys(RB.RULESETS)) for (const b of ['gov', 'cash', 'indirect']) assert.ok(RB.RULESETS[k].basis[b], `${k}.${b} 근거`);
  // 알 수 없는 유형 → 중소기업
  assert.equal(eff({ ruleset: 'x' }).label, '중소기업');
});

test('영리기관은 학생인건비 비목 없음, 비영리는 있음·기관부담 없음', () => {
  assert.ok(!RB.calcBudget(base()).rows.some((r) => r.key === 'student'));
  const r = RB.calcBudget({ ruleset: 'univ', gov: 100000, items: { student: { cash: 50000 }, material: { cash: 45239 } } });
  assert.ok(r.rows.some((x) => x.key === 'student'));
  assert.equal(r.funding.total, 100000);
  assert.equal(r.indirect, 4761); // 95,239 × 5%
  assert.equal(r.total.total, 100000);
  assert.equal(r.checks.filter((c) => c.level === 'error').length, 0);
});

test('위탁연구개발비 40%·기존 인력 현금·장비 3천만 원 안내', () => {
  const lv = (r, l) => r.checks.filter((c) => c.level === l).map((c) => c.msg).join('\n');
  let r = RB.calcBudget(base({ items: { material: { cash: 100000 }, outsource: { cash: 40001 } } }));
  assert.match(lv(r, 'error'), /위탁연구개발비 40,001천원이 한도 40,000천원/);
  r = RB.calcBudget(base({ items: { material: { cash: 100000 }, outsource: { cash: 40000 } } }));
  assert.doesNotMatch(lv(r, 'error'), /위탁/);
  r = RB.calcBudget(base({ people: [{ name: '김', salary: 50000, months: 12, rate: 50, kind: 'existingCash' }], items: { equipment: { cash: 30000 } } }));
  assert.match(lv(r, 'warn'), /김: 기존 인력 인건비는 원칙적으로 현물/);
  assert.match(lv(r, 'warn'), /3천만 원 이상 장비/);
  assert.equal(r.rows.find((x) => x.key === 'personnel').cash, 25000); // 현금으로 집계
  // 이전 저장값(inkind:true) 호환
  assert.equal(RB.calcBudget(base({ people: [{ salary: 12000, months: 12, rate: 100, inkind: true }] })).rows[0].inkind, 12000);
  // 점검 결과에 근거 조문 포함
  assert.ok(r.checks.some((c) => /제114조/.test(c.basis)));
});
