// 실행: node --test "tests/rnd-budget/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const N = require('../../rnd-budget/notice.js');

const FX = path.join(__dirname, 'fixtures');
const txt = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const byField = (items) => Object.fromEntries(items.map((x) => [x.field + (x.type ? ':' + x.type : ''), x.value]));

/** 테스트용 HWPX(ZIP, deflate) 생성 */
function makeHwpx(sections) {
  const files = [['mimetype', 'application/hwp+zip', 0], ...sections.map((xml, i) => [`Contents/section${i}.xml`, xml, 8])];
  const local = [], central = []; let off = 0;
  for (const [name, text, method] of files) {
    const raw = Buffer.from(text, 'utf8'); const data = method ? zlib.deflateRawSync(raw) : raw; const nm = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(method, 8); h.writeUInt32LE(zlib.crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    local.push(h, nm, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10); c.writeUInt32LE(zlib.crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, e]);
}
const hpPara = (lines) => `<?xml version="1.0"?><hs:sec xmlns:hp="x" xmlns:hs="y">${lines.map((l) => `<hp:p><hp:run><hp:t>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`;
module.exports = { makeHwpx, hpPara };

test('금액 → 천원', () => {
  assert.equal(N.toThousand('3억원'), 300000);
  assert.equal(N.toThousand('1억 5천만원'), 150000);
  assert.equal(N.toThousand('450백만원'), 450000);
  assert.equal(N.toThousand('150,000천원'), 150000);
  assert.equal(N.toThousand('300,000,000원'), 300000);
  assert.equal(N.toThousand('2.5억원'), 250000);
});

test('추출: 문장형 공고(기관 유형별 정부지원·현금, 금액·기간·간접비·위탁·연구수당)', () => {
  const f = byField(N.extractNotice(txt('notice-rnd.txt')));
  assert.deepEqual(f, {
    govAnnual: 300000, govTotal: 900000, periodMonths: 33,
    'govMaxPct:중소기업': 75, 'govMaxPct:중견기업': 70, 'govMaxPct:대기업': 50,
    'cashMinPct:중소기업': 10, 'cashMinPct:중견기업': 13, 'cashMinPct:대기업': 15,
    indirectPct: 0, outsourceMaxPct: 20, allowanceMaxPct: 20,
  });
  const it = N.extractNotice(txt('notice-rnd.txt'));
  assert.ok(it.every((x) => x.evidence.length > 10));
  assert.match(it.find((x) => x.field === 'govAnnual').evidence, /연간 3억원/);
});

test('추출: 표가 줄로 나뉜 공고·기관부담 표기 → 정부지원 환산', () => {
  const f = byField(N.extractNotice(txt('notice-rnd2.txt')));
  assert.deepEqual(f, { govAnnual: 150000, periodMonths: 24, 'govMaxPct:중소기업': 75, 'govMaxPct:중견기업': 70, cashMinPct: 10, indirectPct: 5 });
});

test('기관 유형별 값 고르기·사업비와 무관한 비율 무시', () => {
  const it = N.extractNotice(txt('notice-rnd.txt'));
  const v = (r, f) => (N.pickForType(it, r)[f] || {}).value;
  assert.deepEqual([v('sme', 'govMaxPct'), v('sme', 'cashMinPct')], [75, 10]);
  assert.deepEqual([v('midS', 'govMaxPct'), v('midL', 'cashMinPct')], [70, 13]);
  assert.deepEqual([v('large', 'govMaxPct'), v('large', 'cashMinPct')], [50, 15]);
  assert.equal(v('univ', 'govMaxPct'), undefined); // 유형별 값만 있으면 비영리엔 적용 안 함
  assert.equal(v('univ', 'indirectPct'), 0);       // 공통 값은 적용
  const noise = '□ 신청 제외: 부채비율 500% 이상, 유동비율 50% 이하 기업\n참여율 100% 이하\n평가 비중(%) 30\n가점 5% 이내';
  assert.deepEqual(N.extractNotice(noise), []);
});

test('HWPX 읽기(ZIP·deflate·XML)', async () => {
  const buf = makeHwpx([hpPara(['□ 지원규모 : 정부지원연구개발비 연간 2억원 이내', '□ 연구개발기간 : 21개월']), hpPara(['- 정부지원연구개발비 : 중소기업 75% 이하', '- 간접비 계상 불가', 'A&B <표>'])]);
  const t = await N.readHwpx(new Uint8Array(buf));
  assert.match(t, /연간 2억원/); assert.match(t, /A&B <표>/);
  assert.ok(t.indexOf('21개월') < t.indexOf('중소기업'));
  const f = byField(N.extractNotice(t));
  assert.equal(f.govAnnual, 200000); assert.equal(f.periodMonths, 21); assert.equal(f['govMaxPct:중소기업'], 75); assert.equal(f.indirectPct, 0);
});

test('HWP 5.0 읽기(로컬 샘플이 있을 때만)', { skip: !process.env.RB_SAMPLE_HWP }, async () => {
  const t = await N.readHwp(new Uint8Array(fs.readFileSync(process.env.RB_SAMPLE_HWP)));
  assert.ok(t.length > 1000);
  assert.match(t, /공고/);
});

test('형식 오류', async () => {
  await assert.rejects(N.readHwp(new Uint8Array(512)), /cfb/);
  await assert.rejects(N.readHwpx(new Uint8Array(100)), /zip/);
});
