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
  const browser0 = await chromium.launch();
  // 확인창 자동 승인(페이지 안 확인창). 확인창 자체는 ⑥에서 별도 검증
  const browser = { newContext: async (o) => { const c = await browser0.newContext(o); await c.addInitScript(() => { window.__rbAutoConfirm = true; window.__rbAutoInput = '1안'; }); return c; }, close: () => browser0.close() };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '1안' : undefined));
  // ① 기본 설정(1단계 공개 범위): 꺼진 기능은 숨김
  await p.goto(base);
  check('기본: 과제 구성 표시(2026-11-17 공개)·안 저장·단계 메뉴 숨김, Q&A 표시', (await p.locator('#s0').isVisible()) && (await p.locator('#saveScenario').isHidden()) && (await p.locator('.faq').isVisible()) && (await p.locator('.steps').isHidden()));
  check('Q&A 27개', (await p.locator('#faq details').count()) === 27);
  await p.fill('#faqSearch', '현물');
  const shownQ = await p.locator('#faq details:not([hidden])').count();
  check('Q&A 검색(현물)', shownQ >= 3 && shownQ < 23 && (await p.locator('#faq details:not([hidden])').first().getAttribute('open')) !== null, String(shownQ));
  await p.fill('#faqSearch', 'zzzz');
  check('Q&A 검색 결과 없음 안내', await p.locator('#faqEmpty').isVisible());
  await p.fill('#faqSearch', '');
  await p.click('#faqCats [data-qcat="비목"]');
  check('Q&A 분류(비목 5개)', (await p.locator('#faq details:not([hidden])').count()) === 5);
  await p.click('#faqCats [data-qcat=""]');
  check('기본: 집행 전환 표시(공개)', await p.locator('#modeBar').isVisible());
  check('기본: 편성 도우미 버튼 표시(공개)', await p.locator('#helperOpen').isVisible());
  check('기본: 공고문 가져오기 표시(베타)', (await p.locator('#noticeDrop').isVisible()) && (await p.textContent('#noticeDrop')).includes('베타'));
  check('기본: 예시·엑셀·점검 표시', (await p.locator('.demo-bar').isVisible()) && (await p.locator('#xlsx').isVisible()) && (await p.locator('#s4').isVisible()));
  await p.click('[data-example="ok"]'); await p.waitForLoadState();
  check('기본: 예시는 2기관·2개 연차·총괄표 표시', (await p.locator('#summary').isVisible()) && (await p.locator('#instTabs .chip').count()) === 2 && (await p.locator('#yearTabs .chip').count()) === 2 && (await p.inputValue('#gov')) === '300,000' && (await p.locator('#checks .error').count()) === 0);
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
  check('기존 인력 현금 경고', (await p.textContent('#checks')).includes('부처(전문기관) 인정이 필요'));
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
  check('적용: 위탁 20%·연구수당 유지 20%·출처 표시', (await n.inputValue("#outsourceMaxPct")) === '20' && (await n.inputValue('#allowanceMaxPct')) === '20' && (await n.textContent('#ruleHint')).includes('출처: notice-rnd.txt'));
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
  check('다운로드: 점검 통과 표시·시트 목록', (await h.textContent('#dlStatus')).includes('점검 통과') && (await h.locator('#dlSheets li').count()) === 5 && !(await h.isDisabled('#xlsx')));
  await h.fill('#xlsxName', '우리과제_초안');
  const [hd] = await Promise.all([h.waitForEvent('download'), h.click('#xlsx')]);
  check('다운로드: 파일 이름 반영·완료 안내', hd.suggestedFilename() === '우리과제_초안.xlsx' && (await h.textContent('#dlToast')).includes('다운로드됨'), hd.suggestedFilename());
  await h.getByLabel('연구재료비 설명').click();
  check('ⓘ 비목 설명 펼침', (await h.locator('.help-row:not([hidden])').count()) === 1);
  await h.click('[data-example="error"]'); await h.waitForLoadState();
  check('오류 예시: 고치기 버튼 표시', (await h.locator('#checks .fix').count()) >= 4 && (await h.textContent('#fixAll')).includes('한 번에'));
  await h.click('#fixAll');
  check('한 번에 고치기 → 오류 0', (await h.locator('#checks .error').count()) === 0 && (await h.locator('#fixAll').isHidden()) && (await h.textContent('#undoMsg')).includes('모두 고쳤'));
  await h.click('[data-example="error"]'); await h.waitForLoadState();
  check('다운로드: 오류 경고', (await h.textContent('#dlStatus')).includes('점검 오류'));
  let clicks = 0; for (let k = 0; k < 15 && (await h.locator('#checks .fix').count()); k++, clicks++) await h.locator('#checks .fix').first().click();
  check('고치기 반복 → 오류 0', (await h.locator('#checks .error').count()) === 0, await h.textContent('#checks'));
  console.log('   (고치기 클릭 ' + clicks + '회)');
  await hc.close();

  // ⑥ 보안 제한 화면(sandbox iframe, 우측 패널 미리보기와 동일 조건): 페이지 안 확인창·닫기
  const sc = await browser0.newContext({ viewport: { width: 1440, height: 900 } });
  const sp = await sc.newPage();
  sp.on('pageerror', (e) => errors.push('[sandbox] ' + e.message));
  await sp.route('**/__host.html', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><iframe id="f" src="${base}" sandbox="allow-scripts" style="width:1400px;height:880px;border:0"></iframe>` }));
  await sp.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.RB_CONFIG={features:{examples:true,helper:true}};' }));
  await sp.goto(base + '__host.html');
  const fr = sp.frameLocator('#f');
  await fr.locator('#helperOpen').click();
  check('[제한 화면] 도우미 열림', await fr.locator('#helperDlg').isVisible());
  await fr.locator('#hdClose').click();
  check('[제한 화면] 닫기 버튼으로 닫힘', await fr.locator('#helperDlg').isHidden());
  await fr.locator('#helperOpen').click(); await sp.keyboard.press('Escape');
  check('[제한 화면] Esc로 닫힘', await fr.locator('#helperDlg').isHidden());
  await fr.locator('#helperOpen').click(); await fr.locator('#helperDlg').click({ position: { x: 3, y: 3 } }).catch(() => {});
  await sp.mouse.click(10, 10);
  check('[제한 화면] 바깥 클릭으로 닫힘', await fr.locator('#helperDlg').isHidden());
  await fr.locator('#gov').fill('100000');
  await fr.locator('[data-example="ok"]').click();
  check('[제한 화면] 입력 있을 때 예시 → 페이지 안 확인창', (await fr.locator('#askDlg').isVisible()) && (await fr.locator('#askMsg').textContent()).includes('바꿀까요'));
  await fr.locator('#askCancel').click();
  check('[제한 화면] 취소 → 입력 유지', (await fr.locator('#askDlg').isHidden()) && (await fr.locator('#gov').inputValue()) === '100,000');
  await fr.locator('[data-example="ok"]').click(); await fr.locator('#askOk').click();
  await sp.waitForTimeout(500);
  check('[제한 화면] 확인 → 예시 적용', (await fr.locator('#gov').inputValue()) === '300,000');
  await fr.locator('#reset').click();
  check('[제한 화면] 새로 작성 확인창', await fr.locator('#askDlg').isVisible());
  await fr.locator('#askOk').click(); await sp.waitForTimeout(500);
  check('[제한 화면] 새로 작성 → 빈 화면', (await fr.locator('#gov').inputValue()) === '');
  await sc.close();

  // ⑦ 코드 검토 회귀
  const rc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await rc.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rb.current', JSON.stringify({ v: 2, title: 'T', years: 2, insts: [{ name: 'A', role: 'lead', ruleset: 'sme', data: [{ gov: '100000', people: [], items: {} }, { gov: '200000', people: [], items: {} }] }] })); } });
  const r = await rc.newPage(); const rerr = [];
  r.on('pageerror', (e) => rerr.push(e.message));
  await r.goto(base); // 운영 설정(project 끔) + 2개 연차 저장값
  check('[회귀] 운영 설정에서 2개 연차 저장값 → 오류 없이 표시', rerr.length === 0 && (await r.inputValue('#gov')) === '100,000', rerr.join('|'));
  await r.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.RB_CONFIG={features:{examples:true,project:true,execution:true}};' }));
  await r.reload();
  // 집행 납부 행 삭제
  await r.click('#modeBar [data-mode="exec"]');
  await r.click('#xAddPaid'); await r.click('#xAddPaid');
  await r.getByLabel('납부 1 삭제').click();
  check('[회귀] 기관부담 납부 행 삭제', (await r.locator('#xPaid tbody tr').count()) === 1);
  await r.fill('#xStart', '2026-04-01');
  // 이전 연차 복사가 집행 기록을 지우지 않음
  await r.click('#yearTabs .chip >> nth=1'); await r.fill('#xStart', '2027-04-01');
  await r.click('#modeBar [data-mode="plan"]'); await r.click('#copyPrev');
  await r.click('#modeBar [data-mode="exec"]');
  check('[회귀] 이전 연차 복사 후 2차년도 집행 기간 유지', (await r.inputValue('#xStart')) === '2027-04-01');
  await r.click('#modeBar [data-mode="plan"]');
  // 기관 삭제 후 편집 대상 유지
  await r.click('#addInst'); await r.click('#addInst'); // 기관 3개, 편집 = 3번째
  await r.getByLabel('공동기관 1 삭제').click();
  check('[회귀] 앞 기관 삭제 후 편집 대상 유지', (await r.textContent('#curLabel')).includes('공동기관 2'), await r.textContent('#curLabel'));
  // 손상 백업 불러오기 → 기존 유지, 새로고침 후에도 정상
  await r.click('#modeBar [data-mode="exec"]');
  const badBackup = JSON.stringify({ app: 'rnd-budget', v: 3, project: { v: 2, years: 1, insts: [{ name: 'X', role: 'lead', ruleset: 'sme', data: [{ gov: '1', people: [null, 'x'], items: { material: 5 }, exec: { monthly: { material: 5 }, paid: [null] } }] }] } });
  await r.setInputFiles('#backupLoad', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(badBackup) });
  await r.waitForTimeout(400); await r.reload(); await r.waitForTimeout(300);
  check('[회귀] 손상 백업 후에도 앱 정상(새로고침)', rerr.length === 0 && ((await r.locator('#planView').isVisible()) || (await r.locator('#execView').isVisible())), rerr.join('|'));
  await rc.close();

  // ⑧ 사용자 100명 검토 반영
  const uc = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const u = await uc.newPage(); u.on('pageerror', (e) => errors.push('u:' + e.message));
  await u.goto(base); await u.waitForLoadState();
  await u.fill('#gov', '3억'); await u.locator('#gov').blur();
  check('[검토] ‘3억’ 입력 → 300,000천원 환산·원 단위 표시', (await u.inputValue('#gov')) === '300,000' && (await u.textContent('#govWon')).includes('3억 원'), await u.inputValue('#gov'));
  check('[검토] 비목 편성 전에는 다운로드 잠금·‘편성 전’ 표시', (await u.isDisabled('#xlsx')) && (await u.textContent('#live')).includes('편성 전') && (await u.textContent('#dlStatus')).includes('비목을 편성'));
  await u.fill('#gov', '300000000');
  check('[검토] 원 단위 입력 의심 경고·고치기 버튼', (await u.textContent('#checks')).includes('3,000억 원') && (await u.locator('#checks .fix').filter({ hasText: '천원 단위로 바꾸기' }).count()) === 1);
  await u.locator('#checks .fix').filter({ hasText: '천원 단위로 바꾸기' }).click();
  check('[검토] ÷1,000 고치기 → 300,000', (await u.inputValue('#gov')) === '300,000');
  await u.click('#undoBtn');
  check('[검토] 되돌리기 → 직전 값 복원', (await u.inputValue('#gov')) === '300,000,000' && (await u.locator('#undoBar').isHidden()));
  await u.fill('#gov', '300000');
  // 커서 위치 유지: 가운데에 숫자 삽입
  await u.locator('#gov').focus(); await u.evaluate(() => document.getElementById('gov').setSelectionRange(1, 1)); await u.keyboard.type('5');
  check('[검토] 금액 중간 수정 시 커서 유지', (await u.inputValue('#gov')) === '3,500,000' && (await u.evaluate(() => document.getElementById('gov').selectionStart)) === 3, await u.inputValue('#gov'));
  await u.fill('#gov', '300000');
  // 표 안 Enter 이동
  await u.click('#addPerson'); await u.click('#addPerson');
  await u.getByLabel('연구원 1 연봉(천원)').fill('6천만'); await u.keyboard.press('Enter');
  check('[검토] Enter → 아래 행 같은 열·‘6천만’ 환산', (await u.evaluate(() => document.activeElement.getAttribute('aria-label'))) === '연구원 2 연봉(천원)' && (await u.getByLabel('연구원 1 연봉(천원)').inputValue()) === '60,000');
  await u.getByLabel('연구원 1 삭제').click();
  check('[검토] 연구원 삭제 → 되돌리기 제공·포커스 이동', (await u.locator('#undoBar').isVisible()) && (await u.evaluate(() => document.activeElement.id)) === 'addPerson');
  await u.click('#undoBtn');
  check('[검토] 삭제 되돌리기', (await u.locator('#people tbody tr').count()) >= 2 && (await u.getByLabel('연구원 1 연봉(천원)').inputValue()) === '60,000');
  // 직접 입력: 위탁 한도 수정·유형 왕복 시 입력값 기억
  await u.selectOption('#ruleset', 'custom'); await u.fill('#govMaxPct', '65'); await u.fill('#outsourceMaxPct', '30');
  check('[검토] 직접 입력: 요약 즉시 갱신·위탁 한도 수정 가능', (await u.textContent('#ruleSummary')).includes('65%') && !(await u.evaluate(() => document.getElementById('outsourceMaxPct').readOnly)));
  await u.selectOption('#ruleset', 'sme');
  check('[검토] 법령 기준 복귀 시 위탁 한도 40 고정', (await u.inputValue('#outsourceMaxPct')) === '40' && (await u.evaluate(() => document.getElementById('outsourceMaxPct').readOnly)));
  await u.selectOption('#ruleset', 'custom');
  check('[검토] 직접 입력 재선택 → 입력해 둔 비율 복원', (await u.inputValue('#govMaxPct')) === '65' && (await u.inputValue('#outsourceMaxPct')) === '30');
  // 비영리: 구분 문구·초과 편성 안내
  await u.selectOption('#ruleset', 'univ');
  await u.getByLabel('연구재료비 현금(천원)').fill('300000');
  check('[검토] 비영리: 출연금 초과분 자체 부담 안내', (await u.textContent('#checks')).includes('자체 부담'));
  await u.click('#addPerson');
  check('[검토] 비영리: 인건비 구분 ‘현금(정부출연금)’', (await u.locator('#people tbody tr:last-child select').textContent()).includes('현금(정부출연금)'));
  // 편성 화면 백업·저장 상태
  const [bk] = await Promise.all([u.waitForEvent('download'), u.click('#backupSave2')]);
  check('[검토] 편성 화면에서 백업 저장·자동 저장 표시', bk.suggestedFilename().endsWith('.json') && (await u.textContent('#saveStatus')).includes('자동 저장됨') && (await u.textContent('#dlToast')).includes('백업 저장됨'));
  const bkPath = await bk.path();
  await u.click('#reset');
  check('[검토] 새로 작성 → 되돌리기 제공', (await u.inputValue('#gov')) === '' && (await u.locator('#undoBar').isVisible()));
  await u.setInputFiles('#backupLoad2', bkPath); await u.waitForTimeout(300);
  check('[검토] 편성 화면에서 백업 불러오기(화면 유지)', (await u.inputValue('#gov')) === '300,000' && (await u.locator('#planView').isVisible()));
  // 예시를 고친 뒤 다른 예시: 수정 표시(dirty)
  await u.click('[data-example="ok"]'); await u.waitForTimeout(100);
  check('[검토] 예시 직후 수정 전', (await u.evaluate(() => JSON.parse(localStorage.getItem('rb.cur')).dirty)) === false);
  await u.fill('#gov', '250000');
  check('[검토] 예시 수정 → 수정됨 표시(덮어쓰기 전 확인 대상)', (await u.evaluate(() => JSON.parse(localStorage.getItem('rb.cur')).dirty)) === true);
  // 도우미: Enter로 초안·비영리 문구
  await u.click('#helperOpen'); await u.selectOption('#hdRuleset', 'univ');
  check('[검토] 도우미 비영리 문구·학생인건비 칸', (await u.textContent('#hdLegEx')).includes('정부출연금') && (await u.locator('#hdStuBox').isVisible()) && (await u.locator('#hdEqInBox').isHidden()));
  await u.fill('#hdGov', '2억'); await u.keyboard.press('Enter');
  check('[검토] 도우미 Enter → 초안 미리보기', (await u.locator('#hdApply').isVisible()) && (await u.textContent('#hdPreview')).includes('200,000천원'));
  await u.click('#hdClose');
  // 키보드: 파일 버튼·모드 버튼
  check('[검토] 파일 버튼 키보드 접근·모드 버튼 aria-pressed', (await u.locator('label[data-filebtn][tabindex="0"]').count()) === 3 && (await u.getAttribute('#modeBar [data-mode="plan"]', 'aria-pressed')) === 'true');
  // 집행: 종료일 오류·시작일 이동·월 수
  await u.click('#modeBar [data-mode="exec"]');
  await u.fill('#xStart', '2026-04-01'); await u.fill('#xEnd', '2026-12-31');
  check('[검토] 집행: 연차 기간만큼 월 표시(9개월)', (await u.locator('#xGrid thead th').count()) === 11);
  await u.locator('#xGrid tbody tr').first().locator('input').nth(1).fill('5000'); // 26.05
  await u.fill('#xStart', '2026-05-01');
  check('[검토] 집행: 시작일 변경 → 금액이 같은 달로 이동', (await u.locator('#xGrid tbody tr').first().locator('input').nth(0).inputValue()) === '5,000' && (await u.locator('#undoBar').isVisible()));
  await u.fill('#xEnd', '2026-03-01');
  check('[검토] 집행: 종료일이 시작일보다 빠르면 오류', (await u.textContent('#xChecks')).includes('빠릅니다'));
  // 인쇄 머리글
  await u.click('#modeBar [data-mode="plan"]');
  await u.emulateMedia({ media: 'print' }); await u.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  check('[검토] 인쇄: 머리글(과제명·기준일)·버튼 숨김·적용 기준 펼침', (await u.textContent('#printHead')).includes('법령 기준일') && (await u.locator('#printHead').isVisible()) && (await u.locator('#xlsx').isHidden()) && (await u.evaluate(() => document.getElementById('ruleBox').open)));
  await u.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await u.emulateMedia({ media: 'screen' });
  // Q&A 검색 키워드
  await u.fill('#faqSearch', 'undo');
  check('[검토] Q&A 검색 키워드(undo → 되돌리기)', (await u.locator('#faq details:not([hidden])').count()) === 1);
  // 엑셀 점검 시트
  check('[검토] 시트 목록에 점검 결과', (await u.textContent('#dlSheets')).includes('점검 결과'));
  await uc.close();
  // 모바일 하단 요약 막대
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mc.newPage(); m.on('pageerror', (e) => errors.push('m:' + e.message));
  await m.goto(base); await m.click('[data-example="error"]'); await m.waitForTimeout(150);
  check('[검토] 모바일: 하단 요약 막대(총사업비·오류)·가로 넘침 없음', (await m.locator('#mBar').isVisible()) && (await m.textContent('#mBar')).includes('오류') && (await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  check('[검토] 모바일: 입력 글자 16px(확대 방지)', (await m.evaluate(() => getComputedStyle(document.getElementById('gov')).fontSize)) === '16px');
  await mc.close();

  // ⑨ 연차·공동기관 공개(운영 설정 그대로)
  const jc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const j = await jc.newPage(); j.on('pageerror', (e) => errors.push('j:' + e.message));
  await j.goto(base);
  check('[공개] 운영 설정: 과제 구성 표시, 단독 과제는 편집 탭 숨김', (await j.locator('#s0').isVisible()) && (await j.locator('#editBar').isHidden()));
  await j.fill('#gov', '300000'); await j.getByLabel('연구재료비 현금(천원)').fill('400000');
  await j.selectOption('#years', '2');
  check('[공개] 빈 연차 안내(통과로 표시하지 않음)', (await j.textContent('#projChecks')).includes('편성하지 않은 칸이 1곳') && (await j.textContent('#dlStatus')).includes('미편성 1곳'));
  await j.click('#yearTabs .chip >> nth=1'); await j.click('#copyPrev');
  check('[공개] 이전 연차 복사 → 빈 칸 해소·전체 통과', (await j.textContent('#projChecks')).includes('모든 기관·연차') && (await j.textContent('#dlStatus')).includes('점검 통과'));
  await j.click('#addInst'); await j.locator('#insts tbody tr').nth(1).locator('select').nth(1).selectOption('nonprofit');
  await j.fill('#gov', '100000'); await j.getByLabel('연구재료비 현금(천원)').fill('85471');
  check('[공개] 공동기관(비영리) 반올림 1천원 차이는 오류 아님', (await j.locator('#checks .error').count()) === 0 && (await j.locator('#summary tbody tr').count()) === 2);
  await j.click('#helperOpen'); await j.fill('#hdGov', '200000'); await j.click('#hdMake'); await j.click('#hdApply');
  await j.click('#instTabs .chip >> nth=0');
  check('[공개] 도우미는 편집 중인 기관·연차만 바꿈', (await j.inputValue('#gov')) === '300,000');
  check('[공개] 시트 목록에 기관별 시트', (await j.locator('#dlSheets li').count()) === 6);
  await jc.close();
  const jm = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); jm.on('pageerror', (e) => errors.push('jm:' + e.message));
  await jm.goto(base); await jm.click('[data-example="ok"]'); await jm.waitForTimeout(200);
  check('[공개] 모바일: 2기관·2연차 예시 가로 넘침 없음·편집 탭 표시', (await jm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && (await jm.locator('#editBar').isVisible()) && (await jm.evaluate(() => document.getElementById('editBar').offsetHeight)) < 120);

  check('콘솔·스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((x) => !x).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
