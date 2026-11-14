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

function unzip(bytes) {
  const buf = Buffer.from(bytes);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const files = {}; let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const crc = buf.readUInt32LE(off + 14), size = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
    const data = buf.subarray(off + 30 + nlen, off + 30 + nlen + size);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : RB.crc32(data), crc, name);
    files[name] = data.toString('utf8');
    off += 30 + nlen + size;
  }
  return files;
}

test('XLSX(계획서 양식): 시트 구성·CRC·수식·이스케이프', () => {
  const files = unzip(RB.buildXlsx(RB.EXAMPLES.ok.state));
  const wb = files['xl/workbook.xml'];
  for (const n of ['총괄표', '1.(주)예시테크', '2.예시대학교 산학협력단', '인건비 명세', '적용 기준']) assert.match(wb, new RegExp(`name="${n.replace(/[().]/g, '\\$&')}"`), n);
  assert.ok(files['xl/worksheets/sheet5.xml']);
  const t1 = files['xl/worksheets/sheet1.xml'];
  assert.match(t1, /1차년도 소계/); assert.match(t1, /2차년도 소계/); assert.match(t1, /총 합계/);
  assert.match(t1, /<f>SUM\(D5:F5\)<\/f>/);
  const s2 = files['xl/worksheets/sheet2.xml'];
  assert.match(s2, /■ 1차년도/); assert.match(s2, /■ 전체 연차 합계/); assert.match(s2, /정부지원연구개발비/);
  assert.match(files['xl/worksheets/sheet4.xml'], /김책임.*기존 인력\(현물\).*<f>ROUND\(D5\/12\*E5\*F5\/100,0\)<\/f>/);
  assert.match(files['xl/worksheets/sheet5.xml'], /시행령 별표 1 제1호: 정부지원 75% 이하/);
  // 이스케이프·시트명 금지문자 처리
  const f2 = unzip(RB.buildXlsx({ v: 2, title: 'A<B>&"C"', years: 1, insts: [{ name: '연구[소]/A:B', role: 'lead', ruleset: 'sme', data: [{ gov: '1000', people: [], items: { material: { cash: '1500' } } }] }] }));
  assert.match(f2['xl/worksheets/sheet1.xml'], /A&lt;B&gt;&amp;&quot;C&quot;/);
  assert.match(f2['xl/workbook.xml'], /name="1\.연구 소  A B"/);
  assert.equal(RB.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('계획서 비목 배분: 정부지원·기관 현금 합계 보존', () => {
  for (const ex of [RB.EXAMPLES.ok.state, RB.EXAMPLES.error.state]) {
    const P = RB.calcProject(ex);
    for (const it of P.insts) for (const r of it.years) {
      const rows = RB.splitCash(r);
      const g = rows.reduce((a, x) => a + x.gov, 0), o = rows.reduce((a, x) => a + x.orgCash, 0);
      assert.equal(g, Math.min(r.funding.gov, r.total.cash));
      assert.equal(g + o, r.total.cash);
      assert.ok(rows.every((x) => x.gov >= 0 && x.orgCash >= 0));
    }
  }
});

test('과제 단위: 이전 저장값 변환·연차/기관 합계·주관기관 점검', () => {
  // v1(단일 기관·단일 연차) → v2
  const p = RB.normalizeProject({ ruleset: 'midS', title: 'T', gov: '1000', people: [{ name: 'A' }], items: { material: { cash: '5' } } });
  assert.equal(p.v, 2); assert.equal(p.years, 1); assert.equal(p.insts[0].ruleset, 'midS'); assert.equal(p.insts[0].role, 'lead');
  assert.equal(p.insts[0].data[0].gov, '1000'); assert.equal(p.title, 'T');
  assert.equal(RB.normalizeProject({ orgType: 'mid' }).insts[0].ruleset, 'midL');
  // 연차 늘리면 빈 연차 추가, 범위 제한
  const q = RB.normalizeProject({ v: 2, years: 9, insts: [{ name: 'X', role: 'lead', ruleset: 'zzz', data: [] }] });
  assert.equal(q.years, 5); assert.equal(q.insts[0].data.length, 5); assert.equal(q.insts[0].ruleset, 'sme');
  // 합계
  const P = RB.calcProject(RB.EXAMPLES.ok.state);
  assert.equal(P.insts.length, 2); assert.equal(P.yearTotals.length, 2);
  assert.equal(P.total.gov, 800000);
  assert.equal(P.total.total, P.insts[0].total.total + P.insts[1].total.total);
  assert.equal(P.yearTotals[0].total + P.yearTotals[1].total, P.total.total);
  assert.equal(P.insts[1].rules.label, '대학'); // 기관별 기준 적용
  // 주관기관 0곳·2곳 경고
  const two = JSON.parse(JSON.stringify(RB.EXAMPLES.ok.state)); two.insts[1].role = 'lead';
  assert.ok(RB.calcProject(two).checks.some((c) => /주관연구개발기관은 1곳/.test(c.msg)));
  // 기관·연차별 데이터 독립
  const sh = RB.sheetState(P.project, 1, 1);
  assert.equal(sh.ruleset, 'univ'); assert.equal(sh.gov, '100000');
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

test('체험 예시: 정상 예시는 모든 기관·연차 오류 0건, 오류 예시는 주요 오류 모두 표시', () => {
  const ok = RB.calcProject(RB.EXAMPLES.ok.state);
  for (const it of ok.insts) for (const r of it.years) assert.equal(r.errors, 0, `${it.name}`);
  assert.equal(ok.checks[0].level, 'ok');
  const err = RB.calcBudget(RB.sheetState(RB.normalizeProject(RB.EXAMPLES.error.state), 0, 0)).checks.filter((c) => c.level === 'error').map((c) => c.msg).join('\n');
  for (const re of [/최소 총사업비보다/, /현금 .*부족/, /연구수당/, /위탁연구개발비/, /총 참여율/]) assert.match(err, re);
});

// ---------- 집행 현황판 ----------
const execProject = () => {
  const p = RB.normalizeProject(RB.EXAMPLES.ok.state);
  p.insts[0].data[0].exec = { start: '2026-04-01', end: '2027-03-31',
    monthly: { personnel: [3500, 3250, 3250, 3250, 3250, 3250, 3250, 3250], equipment: [0, 0, 45000, 0, 13000], material: [0, 2400, 5100, 3800, 6200, 4300, 5100, 4300], outsource: [0, 0, 0, 20000], activity: [1200, 1800, 2100, 1600, 2300, 1500, 1900, 1600], allowance: [0, 0, 0, 0, 0, 4500, 0, 5000], indirect: [1500, 1700, 2200, 1800, 2100, 1900, 1900, 1900] },
    paid: [{ date: '2026-06-30', amount: '5000' }] };
  return p;
};

test('집행: 경과율·집행률·잔액·상태(±25%p)', () => {
  const E = RB.calcExecution(execProject(), 0, 0, '2026-11-13');
  assert.equal(E.elapsedPct, 62.2); assert.deepEqual(E.days, { passed: 227, total: 365 });
  assert.deepEqual(E.total, { agreed: 313900, spent: 173950, remain: 139950, rate: 55.4 });
  const st = Object.fromEntries(E.rows.map((r) => [r.key, r.status]));
  assert.deepEqual(st, { personnel: 'ok', equipment: 'fast', material: 'slow', outsource: 'ok', activity: 'ok', allowance: 'over', indirect: 'ok' });
  assert.equal(E.months[0], '2026-04'); assert.equal(E.months[11], '2027-03');
  const msg = E.checks.map((c) => c.msg).join('\n');
  assert.match(msg, /연구수당 9,500천원 — 협약액 9,000천원 초과/);
  assert.match(msg, /기관부담 현금 8,900천원 미납 — 기한 2026-12-31\(연차 종료 3개월 전\), D-48/);
  assert.deepEqual(E.schedule.map((s) => [s.date, s.dday]), [['2026-12-31', 48], ['2027-01-31', 79], ['2027-03-31', 138]]);
});

test('집행: 협약 조정·기한(협약)·경계값·기간 미입력', () => {
  const p = execProject(); const ex = p.insts[0].data[0].exec;
  ex.agreed = { allowance: '10000' }; ex.cashDue = '2026-11-01';
  let E = RB.calcExecution(p, 0, 0, '2026-11-13');
  assert.equal(E.rows.find((r) => r.key === 'allowance').status, 'fast'); // 9,500/10,000 = 95% > 경과율+25
  assert.ok(E.checks.some((c) => c.level === 'error' && /기한 2026-11-01\(협약\) 경과/.test(c.msg)));
  // 부진 경계: 경과율 − 25 정확히는 정상
  ex.monthly.material = []; ex.agreed.material = '1000'; ex.monthly.material[0] = 372; // 37.2% = 62.2 − 25
  assert.equal(RB.calcExecution(p, 0, 0, '2026-11-13').rows.find((r) => r.key === 'material').status, 'ok');
  ex.monthly.material[0] = 371;
  assert.equal(RB.calcExecution(p, 0, 0, '2026-11-13').rows.find((r) => r.key === 'material').status, 'slow');
  // 인건비는 과속 판정 제외
  ex.monthly.personnel = [35000];
  assert.equal(RB.calcExecution(p, 0, 0, '2026-11-13').rows.find((r) => r.key === 'personnel').status, 'ok');
  // 기간 미입력
  E = RB.calcExecution(RB.normalizeProject(RB.EXAMPLES.ok.state), 0, 0, '2026-11-13');
  assert.equal(E.ready, false); assert.equal(E.elapsedPct, 0); assert.match(E.checks[0].msg, /시작일·종료일/);
  // 잘못된 날짜 정리, 월말 보정
  assert.equal(RB.normalizeExec({ start: '2026-02-30', end: 'x' }).start, '');
  assert.equal(RB.ymdAddMonths('2027-05-31', -3), '2027-02-28');
  // 종료일 이후 경과율 100% 상한
  assert.equal(RB.calcExecution(execProject(), 0, 0, '2028-01-01').elapsedPct, 100);
});

test('집행 엑셀: 시트 구성·수식', () => {
  const files = unzip(RB.buildExecXlsx(execProject(), 0, 0, '2026-11-13'));
  for (const n of ['집행 현황', '월별 집행', '기관부담 현금', '점검·일정']) assert.match(files['xl/workbook.xml'], new RegExp(`name="${n}"`));
  assert.match(files['xl/worksheets/sheet1.xml'], /<f>B5-C5<\/f>/);
  assert.match(files['xl/worksheets/sheet1.xml'], /초과/);
  assert.match(files['xl/worksheets/sheet2.xml'], /2026-04/);
  assert.match(files['xl/worksheets/sheet3.xml'], /2026-06-30/);
});

test('v2 저장값에 exec 자동 추가, 편성 계산 영향 없음', () => {
  const p = RB.normalizeProject(RB.EXAMPLES.ok.state);
  assert.deepEqual(p.insts[0].data[0].exec, RB.blankExec());
  assert.equal(RB.calcProject(p).total.total, RB.calcProject(RB.EXAMPLES.ok.state).total.total);
});

// ---------- 처음 편성 도우미 ----------
test('도우미 초안: 최소 총사업비·현금 기준을 정확히 충족', () => {
  for (const [ruleset, gov] of [['sme', 300000], ['midS', 150000], ['midL', 200000], ['large', 500000], ['univ', 100000]]) {
    const d = RB.draftBudget({ ruleset, gov, existing: { count: 3, salary: 60000, rate: 40 }, hires: { count: 1, salary: 42000, months: 10 }, equipCash: 50000, equipInkind: 10000, outsource: 30000 });
    assert.equal(d.result.checks.filter((c) => c.level === 'error').length, 0, ruleset);
    assert.ok(d.result.total.total >= d.result.funding.total, ruleset);
    // 연구재료비 1천원만 줄여도 기준 미달(최소값)
    const less = { ...d.sheet, ruleset, items: { ...d.sheet.items, material: { cash: String(RB.int(d.sheet.items.material.cash) - 1) } } };
    if (RB.int(d.sheet.items.material.cash) > 0) assert.ok(RB.calcBudget(less).checks.some((c) => c.code === 'total' || c.code === 'cash'), ruleset);
  }
  const d = RB.draftBudget({ ruleset: 'sme', gov: 300000, existing: { count: 3, salary: 60000, rate: 40 } });
  assert.equal(d.sheet.people.length, 3); assert.equal(d.sheet.people[0].kind, 'existing');
  assert.equal(RB.int(d.sheet.items.allowance.cash), Math.floor(72000 * 0.1));
  assert.equal(d.result.total.total, 400000);
});

test('고치기 제안: 적용하면 오류 해소', () => {
  let sh = RB.sheetState(RB.normalizeProject(RB.EXAMPLES.error.state), 0, 0);
  const codes = RB.suggestFixes(sh).map((f) => f.code).sort();
  assert.deepEqual(codes, ['allowance', 'kindcash', 'outsource', 'rate', 'total']);
  for (let k = 0; k < 4; k++) { const fx = RB.suggestFixes(sh); if (!fx.length) break; for (const f of fx) sh = { ...sh, ...RB.applyFix(sh, f) }; }
  assert.equal(RB.calcBudget(sh).checks.filter((c) => c.level === 'error').length, 0);
  // 원본 불변
  const orig = RB.sheetState(RB.normalizeProject(RB.EXAMPLES.error.state), 0, 0);
  RB.applyFix(orig, RB.suggestFixes(orig)[0]);
  assert.equal(orig.items.material.cash, '150000');
  // 비목 설명
  for (const k of ['personnel', 'equipment', 'material', 'outsource', 'activity', 'allowance', 'indirect']) assert.ok(RB.ITEM_HELP[k]);
});

test('한 번에 고치기: 오류 0, 주의 항목은 유지', () => {
  const sh = RB.sheetState(RB.normalizeProject(RB.EXAMPLES.error.state), 0, 0);
  const r = RB.autoFix(sh);
  assert.equal(r.remaining, 0);
  assert.ok(r.applied.length >= 4);
  assert.equal(r.sheet.people[1].kind, 'existingCash'); // 주의(warn) 항목은 사용자가 판단
  assert.equal(RB.calcBudget(r.sheet).checks.filter((c) => c.level === 'error').length, 0);
});
