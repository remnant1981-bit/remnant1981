// E2E: 실제 Chromium에서 계산기 전체 흐름 검증.  실행: node tests/rnd-budget/e2e.js   (playwright 필요)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'rnd-budget');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.bcmap': 'application/octet-stream' };
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
  // ① 기본 설정(1단계 공개 범위): 꺼진 기능은 숨김
  await p.goto(base);
  check('기본: 과제 구성·안 저장·FAQ·단계 메뉴 숨김', (await p.locator('#s0').isHidden()) && (await p.locator('#saveScenario').isHidden()) && (await p.locator('.faq').isHidden()) && (await p.locator('.steps').isHidden()));
  check('기본: 집행 전환 표시(공개)', await p.locator('#modeBar').isVisible());
  check('기본: 공고문 가져오기 표시(베타)', (await p.locator('#noticeDrop').isVisible()) && (await p.textContent('#noticeDrop')).includes('베타'));
  check('기본: 예시·엑셀·점검 표시', (await p.locator('.demo-bar').isVisible()) && (await p.locator('#xlsx').isVisible()) && (await p.locator('#s4').isVisible()));
  await p.click('[data-example="ok"]'); await p.waitForLoadState();
  check('기본: 예시는 첫 기관·1차년도만', (await p.locator('#summary').isHidden()) && (await p.inputValue('#gov')) === '300,000' && (await p.locator('#checks .error').count()) === 0);
  check('우측 요약: 총사업비·점검 통과', (await p.textContent('#live')).includes('423,900') && (await p.textContent('#live')).includes('통과'));
  await p.evaluate(() => localStorage.clear());

  // ② 전체 기능 켠 설정으로 기존 시나리오 검증
  const ALL = 'examples:true,project:true,scenarios:true,faq:true,steps:true,legalHeader:true';
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.RB_CONFIG={features:{${ALL}}};` }));
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
  await p.unroute('**/config.js');
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.RB_CONFIG={adsenseClient:"ca-pub-0000000000000000",adsenseSlots:{top:"111",bottom:"222"},features:{${ALL}}};` }));
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

  // ③ 집행 현황판(execution 켬), 기준일 고정
  const xc = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await xc.clock.setFixedTime(new Date('2026-11-13T12:00:00+09:00'));
  const x = await xc.newPage();
  x.on('pageerror', (e) => errors.push(e.message));
  x.on('dialog', (d) => d.accept());
  await x.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.RB_CONFIG={features:{examples:true,execution:true}};' }));
  await x.goto(base);
  await x.click('[data-example="ok"]'); await x.waitForLoadState();
  check('집행: 전환 버튼 표시', await x.locator('#modeBar').isVisible());
  await x.click('#modeBar [data-mode="exec"]');
  check('집행 화면 전환', (await x.locator('#execView').isVisible()) && (await x.locator('#planView').isHidden()));
  check('기간 미입력 안내', (await x.textContent('#xChecks')).includes('시작일·종료일'));
  await x.fill('#xStart', '2026-04-01'); await x.fill('#xEnd', '2027-03-31');
  check('경과율 62.2%', (await x.textContent('#xKpis')).includes('62.2%'), await x.textContent('#xKpis'));
  check('월 헤더(26.04~)', (await x.textContent('#xGrid thead')).includes('26.04'));
  await x.getByLabel('연구수당 2026-09 집행액(천원)').fill('4500');
  await x.getByLabel('연구수당 2026-11 집행액(천원)').fill('5000');
  await x.getByLabel('연구재료비 2026-05 집행액(천원)').fill('31200');
  const xr = await x.textContent('#xRows');
  check('현황표: 연구수당 초과·재료비 부진', xr.includes('✖ 초과') && xr.includes('⚠ 부진') && xr.includes('-500'), xr);
  check('점검: 초과 오류 먼저', (await x.locator('#xChecks li').first().getAttribute('class')) === 'error');
  await x.click('#xAddPaid');
  await x.getByLabel('납부 1 금액(천원)').fill('5000');
  check('기관부담 현금 납부 누계', (await x.textContent('#xPaidSum')).startsWith('5,000 / 13,900'));
  check('일정 D-48', (await x.textContent('#xSched')).includes('D-48'));
  await x.getByLabel('연구수당 협약 금액(천원, 비우면 편성액)').fill('10000');
  check('협약 금액 조정 → 초과 해소', !(await x.textContent('#xRows')).includes('✖ 초과'));
  const [xd] = await Promise.all([x.waitForEvent('download'), x.click('#xXlsx')]);
  check('집행 현황 엑셀', xd.suggestedFilename().endsWith('.xlsx') && fs.readFileSync(await xd.path()).readUInt32LE(0) === 0x04034b50, xd.suggestedFilename());
  const [bd] = await Promise.all([x.waitForEvent('download'), x.click('#backupSave')]);
  const backupPath = await bd.path();
  const bj = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check('백업 파일(JSON)', bj.app === 'rnd-budget' && bj.project.insts[0].data[0].exec.start === '2026-04-01');
  await x.reload();
  check('새로고침 후 집행 화면·입력 유지', (await x.locator('#execView').isVisible()) && (await x.inputValue('#xStart')) === '2026-04-01');
  await x.evaluate(() => localStorage.clear()); await x.reload();
  check('초기화 후 빈 상태', (await x.locator('#planView').isVisible()) && (await x.inputValue('#gov')) === '');
  await x.click('#modeBar [data-mode="exec"]');
  const fp = path.join(require('os').tmpdir(), 'rb-backup.json'); fs.copyFileSync(backupPath, fp);
  await x.setInputFiles('#backupLoad', fp); await x.waitForLoadState(); await x.waitForTimeout(300);
  check('백업 불러오기 → 복원', (await x.inputValue('#xStart')) === '2026-04-01' && (await x.textContent('#xRows')).includes('9,500'));
  await x.setInputFiles('#backupLoad', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"x":1}') });
  check('잘못된 백업 거부(기존 유지)', (await x.inputValue('#xStart')) === '2026-04-01');
  const sw3 = await x.evaluate(() => document.documentElement.scrollWidth);
  check('집행 화면 PC 가로 스크롤 없음', sw3 <= 1440, String(sw3));
  await x.click('#modeBar [data-mode="plan"]');
  check('편성으로 복귀', await x.locator('#planView').isVisible());
  await xc.close();

  // ④ 공고문에서 기준 가져오기(noticeImport 켬)
  const nc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const n = await nc.newPage();
  n.on('pageerror', (e) => errors.push(e.message));
  n.on('dialog', (d) => d.accept());
  await n.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.RB_CONFIG={features:{examples:true,noticeImport:true}};' }));
  await n.goto(base);
  check('공고문 가져오기 영역 표시', await n.locator('#noticeDrop').isVisible());
  const FX = path.join(__dirname, 'fixtures');
  await n.selectOption('#ruleset', 'midS');
  await n.setInputFiles('#noticeFile', path.join(FX, 'notice-rnd.txt'));
  await n.waitForSelector('.ntbl');
  const nt = await n.textContent('#noticeResult');
  check('TXT: 중견기업 기준 70%·13%·연간 300,000', nt.includes('70% 이하') && nt.includes('13% 이상') && nt.includes('300,000천원') && nt.includes('(중견기업)'), nt.slice(0, 300));
  await n.getByLabel('연구수당 한도 적용').uncheck();
  await n.click('#noticeResult >> text=선택 항목 적용');
  check('적용: 공고문 기준·값 반영', (await n.inputValue('#ruleset')) === 'custom' && (await n.inputValue('#govMaxPct')) === '70' && (await n.inputValue('#cashMinPct')) === '13' && (await n.inputValue('#indirectPct')) === '0' && (await n.inputValue('#gov')) === '300,000');
  check('적용: 위탁 20%·연구수당 유지 20%·출처 표시', (await n.textContent('#outsourceFixed')) === '20' && (await n.inputValue('#allowanceMaxPct')) === '20' && (await n.textContent('#ruleHint')).includes('출처: notice-rnd.txt'));
  check('적용 후 최소 총사업비(70%)', (await n.textContent('#funding')).includes('428,572천원'));
  // HWPX
  const zlib = require('zlib');
  const hp = (lines) => `<hs:sec xmlns:hp="x" xmlns:hs="y">${lines.map((l) => `<hp:p><hp:run><hp:t>${l}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`;
  const files = [['mimetype', 'application/hwp+zip', 0], ['Contents/section0.xml', hp(['□ 지원규모 : 정부지원연구개발비 연간 2억원 이내', '- 정부지원연구개발비 : 중소기업 75% 이하', '- 기관부담연구개발비 중 현금 : 중소기업 10% 이상']), 8]];
  const loc = [], cen = []; let off = 0;
  for (const [nm0, text, method] of files) { const raw = Buffer.from(text); const data = method ? zlib.deflateRawSync(raw) : raw; const nm = Buffer.from(nm0); const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(method, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26); loc.push(h, nm, data); const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42); cen.push(c, nm); off += 30 + nm.length + data.length; }
  const cd = Buffer.concat(cen), eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(files.length, 8); eo.writeUInt16LE(files.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
  await n.selectOption('#ruleset', 'sme');
  await n.setInputFiles('#noticeFile', { name: '공고.hwpx', mimeType: 'application/octet-stream', buffer: Buffer.concat([...loc, cd, eo]) });
  await n.waitForSelector('.ntbl');
  check('HWPX: 연간 200,000·75%·10%', (await n.textContent('#noticeResult')).includes('200,000천원') && (await n.textContent('#noticeResult')).includes('75% 이하'));
  // PDF(pdf.js, 필요 시 로드)
  await n.setInputFiles('#noticeFile', path.join(FX, 'notice-rnd.pdf'));
  await n.waitForFunction(() => /찾은 기준|읽지 못|찾지 못/.test(document.querySelector('#noticeResult').textContent) && !/읽는 중/.test(document.querySelector('#noticeResult').textContent), null, { timeout: 30000 });
  const np = await n.textContent('#noticeResult');
  check('PDF: 기준 추출', np.includes('찾은 기준') && np.includes('300,000천원') && np.includes('75% 이하'), np.slice(0, 200));
  // 비율 조항 없는 문서·지원하지 않는 형식
  await n.setInputFiles('#noticeFile', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('□ 지원내용: 컨설팅 지원\n부채비율 500% 이상 기업 제외') });
  await n.waitForFunction(() => /찾지 못/.test(document.querySelector('#noticeResult').textContent));
  check('조항 없는 공고 → 직접 입력 안내', (await n.textContent('#noticeResult')).includes('찾지 못했습니다'));
  await n.setInputFiles('#noticeFile', { name: 'x.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await n.waitForFunction(() => /지원합니다/.test(document.querySelector('#noticeResult').textContent));
  check('지원하지 않는 형식 안내', true);
  if (process.env.RB_SAMPLE_HWP) {
    await n.setInputFiles('#noticeFile', process.env.RB_SAMPLE_HWP);
    await n.waitForFunction(() => !/읽는 중/.test(document.querySelector('#noticeResult').textContent));
    const nh = await n.textContent('#noticeResult');
    check('HWP(실제 공고): 읽기 성공·비율 조항 없음 안내', nh.includes('찾지 못했습니다'), nh.slice(0, 200));
  }
  await nc.close();

  // ⑤ 편성 도우미(helper 켬) + 다운로드 카드
  const hc = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const h = await hc.newPage();
  h.on('pageerror', (e) => errors.push(e.message));
  h.on('dialog', (d) => d.accept());
  await h.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.RB_CONFIG={features:{examples:true,helper:true}};' }));
  await h.goto(base);
  check('다운로드: 입력 전 비활성·안내', (await h.isDisabled('#xlsx')) && (await h.textContent('#dlStatus')).includes('정부출연금을 입력'));
  await h.click('#helperOpen');
  check('도우미 열림', await h.locator('#helperDlg').isVisible());
  await h.fill('#hdGov', '300000'); await h.fill('#hdExN', '3'); await h.fill('#hdExSal', '60000'); await h.fill('#hdExRate', '40');
  await h.fill('#hdHiN', '1'); await h.fill('#hdHiSal', '42000'); await h.fill('#hdHiM', '10'); await h.fill('#hdEq', '50000');
  await h.click('#hdMake');
  check('도우미: 초안 미리보기 기준 충족', (await h.textContent('#hdPreview')).includes('초안이 법령 기준을 충족') && (await h.textContent('#hdPreview')).includes('400,000천원'));
  await h.click('#hdApply');
  check('도우미: 초안 반영(오류 0·인원 4명)', (await h.locator('#helperDlg').isHidden()) && (await h.inputValue('#gov')) === '300,000' && (await h.locator('#people tbody tr').count()) === 4 && (await h.locator('#checks .error').count()) === 0);
  check('다운로드: 점검 통과 표시·시트 목록', (await h.textContent('#dlStatus')).includes('점검 통과') && (await h.locator('#dlSheets li').count()) === 4 && !(await h.isDisabled('#xlsx')));
  await h.fill('#xlsxName', '우리과제_초안');
  const [hd] = await Promise.all([h.waitForEvent('download'), h.click('#xlsx')]);
  check('다운로드: 파일 이름 반영·완료 안내', hd.suggestedFilename() === '우리과제_초안.xlsx' && (await h.textContent('#dlToast')).includes('다운로드됨'), hd.suggestedFilename());
  await h.getByLabel('연구재료비 설명').click();
  check('ⓘ 비목 설명 펼침', (await h.locator('.help-row:not([hidden])').count()) === 1);
  await h.click('[data-example="error"]'); await h.waitForLoadState();
  check('오류 예시: 고치기 버튼 표시', (await h.locator('#checks .fix').count()) >= 4 && (await h.textContent('#fixAll')).includes('한 번에'));
  await h.click('#fixAll');
  check('한 번에 고치기 → 오류 0', (await h.locator('#checks .error').count()) === 0 && (await h.locator('#fixAll').isHidden()) && (await h.textContent('#dlToast')).includes('모두 고쳤'));
  await h.click('[data-example="error"]'); await h.waitForLoadState();
  check('다운로드: 오류 경고', (await h.textContent('#dlStatus')).includes('점검 오류'));
  let clicks = 0; for (let k = 0; k < 15 && (await h.locator('#checks .fix').count()); k++, clicks++) await h.locator('#checks .fix').first().click();
  check('고치기 반복 → 오류 0', (await h.locator('#checks .error').count()) === 0, await h.textContent('#checks'));
  console.log('   (고치기 클릭 ' + clicks + '회)');
  await hc.close();

  check('콘솔·스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((x) => !x).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
