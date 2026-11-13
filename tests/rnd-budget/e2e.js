// E2E: 실제 Chromium에서 계산기 전체 흐름 검증.  실행: node tests/rnd-budget/e2e.js   (playwright 필요)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'rnd-budget');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  → ' + detail}`); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '1안' : undefined));
  await p.goto(base);

  // 1. 법령 기준 고정
  check('기본 중소기업·법령 기준 고정', (await p.inputValue('#ruleset')) === 'sme' && (await p.textContent('#ruleMode')) === '법령 기준 고정');
  check('정부지원 75%·현금 10% 잠금', (await p.inputValue('#govMaxPct')) === '75' && (await p.inputValue('#cashMinPct')) === '10' && await p.$eval('#govMaxPct', (e) => e.readOnly));
  check('근거 조문 표시', (await p.textContent('[data-basis="cash"]')).includes('시행령 별표 1'));
  await p.fill('#gov', '300000');
  check('정부출연금 천단위 표시', (await p.inputValue('#gov')) === '300,000');
  const kpi = await p.textContent('#funding');
  check('최소 총사업비·기관부담금·현금', kpi.includes('400,000천원') && kpi.includes('100,000천원') && kpi.includes('10,000천원'), kpi);
  await p.selectOption('#ruleset', 'midS');
  check('중견(3천억 미만) 70%/10%', (await p.inputValue('#govMaxPct')) === '70' && (await p.inputValue('#cashMinPct')) === '10');
  await p.selectOption('#ruleset', 'midL');
  check('중견(3천억 이상) 13%', (await p.inputValue('#cashMinPct')) === '13');
  await p.selectOption('#ruleset', 'custom');
  check('직접 입력: 편집 가능·직전 값 유지', !(await p.$eval('#govMaxPct', (e) => e.readOnly)) && (await p.inputValue('#cashMinPct')) === '13');
  await p.fill('#govMaxPct', '80');
  check('직접 입력 비율 반영', (await p.textContent('#funding')).includes('375,000천원'));
  await p.selectOption('#ruleset', 'univ');
  check('대학: 학생인건비 비목 표시', (await p.locator('#items tbody tr', { hasText: '학생인건비' }).count()) === 1);
  await p.selectOption('#ruleset', 'sme');
  check('기업: 학생인건비 비목 없음', (await p.locator('#items tbody tr', { hasText: '학생인건비' }).count()) === 0);
  await p.fill('#indirectPct', '30'); await p.locator('#indirectPct').blur();
  check('간접비율 상한(10%) 초과 입력 시 10%', (await p.inputValue('#indirectPct')) === '10');

  // 2~4. 편성·점검
  const row = p.locator('#people tbody tr').first();
  await row.getByLabel('연구원 1 성명').fill('홍길동');
  await row.getByLabel('연구원 1 연봉(천원)').fill('90000');
  check('연봉 천단위', (await row.getByLabel('연구원 1 연봉(천원)').inputValue()) === '90,000');
  await row.getByLabel('연구원 1 참여율').fill('100');
  await p.fill('#indirectPct', '0');
  await p.getByLabel('연구재료비 현금(천원)').fill('300000');
  check('남은 편성액 안내', (await p.textContent('#remain')).includes('10,000천원 더'));
  await p.getByLabel('연구활동비 현금(천원)').fill('10000');
  check('정상 편성 → 오류 없음', (await p.locator('#checks .error').count()) === 0, await p.textContent('#checks'));
  check('합계 400,000·충족 안내', (await p.textContent('#items tfoot')).includes('400,000') && (await p.textContent('#remain')).includes('충족'));
  await p.getByLabel('연구수당 현금(천원)').fill('30000');
  const err = await p.textContent('#checks .error');
  check('연구수당 한도 초과 + 근거', err.includes('연구수당') && err.includes('제26조'), err);
  await p.getByLabel('연구수당 현금(천원)').fill('');
  await row.getByLabel('연구원 1 구분').selectOption('existingCash');
  check('기존 인력 현금 경고', (await p.textContent('#checks')).includes('부처(전문기관)가 인정한 경우'));
  await row.getByLabel('연구원 1 구분').selectOption('existing');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  check('390px 가로 스크롤 없음', sw <= 390, String(sw));
  await p.reload();
  check('새로고침 후 입력 유지', (await p.inputValue('#gov')) === '300,000' && (await p.locator('#checks .error').count()) === 0);

  // 5. 엑셀·저장(무료)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xlsx')]);
  const head = fs.readFileSync(await dl.path()).subarray(0, 4);
  check('엑셀 다운로드(.xlsx)', dl.suggestedFilename().endsWith('.xlsx') && head.readUInt32LE(0) === 0x04034b50, dl.suggestedFilename());
  await p.click('#saveScenario');
  check('안 저장', (await p.textContent('#scenarios')).includes('1안'));
  check('광고 미설정 시 광고 영역 숨김', (await p.locator('#ad-top').isHidden()) && (await p.locator('#ad-bottom').isHidden()));

  // 광고 설정 시
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.RB_CONFIG={adsenseClient:"ca-pub-0000000000000000",adsenseSlots:{top:"111",bottom:"222"}};' }));
  await p.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.__adLoaded=true;' }));
  await p.reload();
  check('광고 설정 시 2곳 표시·스크립트 로드', (await p.locator('#ad-top ins.adsbygoogle').count()) === 1 && (await p.locator('#ad-bottom ins.adsbygoogle').count()) === 1 && await p.evaluate(() => window.__adLoaded === true));

  // 예시(데모)
  await p.click('[data-example="error"]'); await p.waitForLoadState();
  check('오류 예시: 오류 5건 이상·배너', (await p.locator('#checks .error').count()) >= 5 && await p.locator('#demoNote').isVisible() && (await p.inputValue('#ruleset')) === 'midS');
  await p.click('[data-example="ok"]'); await p.waitForLoadState();
  check('정상 예시: 오류 0건', (await p.locator('#checks .error').count()) === 0 && (await p.inputValue('#gov')) === '300,000', await p.textContent('#checks'));
  await p.click('#demoNote .linkbtn'); await p.waitForLoadState();
  check('새로 작성 → 빈 화면', (await p.inputValue('#gov')) === '' && await p.locator('#demoNote').isHidden());

  // 연차·공동기관
  check('단일 기관·1개 연차는 편집 탭 숨김', await p.locator('#editBar').isHidden());
  await p.fill('#gov', '100000');
  await p.getByLabel('연구재료비 현금(천원)').fill('130000');
  await p.selectOption('#years', '2');
  check('2개 연차 → 편집 탭 표시', (await p.locator('#editBar').isVisible()) && (await p.locator('#yearTabs .chip').count()) === 2);
  await p.click('#yearTabs .chip >> nth=1');
  check('2차년도는 빈 입력', (await p.inputValue('#gov')) === '' && (await p.textContent('#curLabel')).includes('2차년도'));
  await p.click('#copyPrev');
  check('이전 연차 복사', (await p.inputValue('#gov')) === '100,000' && (await p.getByLabel('연구재료비 현금(천원)').inputValue()) === '130,000');
  await p.fill('#gov', '120000');
  await p.click('#addInst');
  check('공동기관 추가 → 해당 기관 편집', (await p.locator('#instTabs .chip').count()) === 2 && (await p.textContent('#curLabel')).includes('공동기관 1 · 1차년도'));
  await p.getByLabel('기관 2 유형').selectOption('univ');
  check('기관별 유형: 대학 → 학생인건비·정부 100%', (await p.inputValue('#govMaxPct')) === '100' && (await p.locator('#items tbody tr', { hasText: '학생인건비' }).count()) === 1);
  await p.fill('#gov', '50000');
  await p.getByLabel('학생인건비 현금(천원)').fill('40000');
  const sum = await p.textContent('#summary');
  check('총괄표: 기관 2 × 연차 2 + 합계', (await p.locator('#summary tbody tr').count()) === 2 && sum.includes('합계'), sum);
  check('오류 있는 칸 표시', (await p.locator('#summary .sumcell.bad').count()) >= 1 && (await p.textContent('#projChecks')).includes('오류'));
  await p.locator('#summary tbody tr').first().locator('.sumcell').nth(1).click();
  check('총괄표 칸 클릭 → 주관 2차년도 편집', (await p.textContent('#curLabel')).includes('2차년도') && (await p.inputValue('#gov')) === '120,000' && (await p.inputValue('#ruleset')) === 'sme');
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#xlsx')]);
  const wbx = fs.readFileSync(await dl2.path()).toString('latin1');
  check('엑셀: 총괄표·기관별·인건비·기준 시트', ['sheet5.xml'].every((n) => wbx.includes(n)));
  await p.reload();
  check('새로고침 후 편집 위치·구성 유지', (await p.locator('#instTabs .chip').count()) === 2 && (await p.textContent('#curLabel')).includes('2차년도'));
  await p.getByLabel('공동기관 1 삭제').click();
  check('기관 삭제', (await p.locator('#insts tbody tr').count()) === 1);
  const sw2 = await p.evaluate(() => document.documentElement.scrollWidth);
  check('다기관 화면 390px 가로 스크롤 없음', sw2 <= 390, String(sw2));
  await p.click('[data-example="ok"]'); await p.waitForLoadState();
  check('정상 예시(2기관·2연차): 총괄 오류 0', (await p.locator('#summary .sumcell.bad').count()) === 0 && (await p.locator('#summary tbody tr').count()) === 2 && (await p.textContent('#projChecks')).includes('통과'));

  check('콘솔·스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((x) => !x).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
