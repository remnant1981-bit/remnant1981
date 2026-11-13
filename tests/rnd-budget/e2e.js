// E2E: 실제 Chromium에서 계산기 전체 흐름 검증.  실행: node tests/rnd-budget/e2e.js   (playwright 필요)
const http = require('http');
const fs = require('fs');
const os = require('os');
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
  const { keygen, issue } = await import('../../scripts/rnd-budget/license.mjs');
  const keyPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rb-e2e-')), 'k.jwk');
  const pub = await keygen(keyPath);
  const { code } = await issue('E2E-1', 30, keyPath);

  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];

  // 1) 기본 설정(판매 준비 중) — 모바일
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '1안' : undefined));
  await p.goto(base);
  await p.fill('#gov', '300000');
  check('정부출연금 천단위 표시', (await p.inputValue('#gov')) === '300,000');
  const kpi = await p.textContent('#funding');
  check('최소 총사업비·기관부담금 계산', kpi.includes('400,000천원') && kpi.includes('100,000천원') && kpi.includes('10,000천원'), kpi);
  await p.selectOption('#orgType', 'mid');
  check('중견기업 선택 시 70%/13%', (await p.inputValue('#govMaxPct')) === '70' && (await p.inputValue('#cashMinPct')) === '13');
  await p.selectOption('#orgType', 'sme');
  // 인건비: 기존 인력 현물 90,000
  const row = p.locator('#people tbody tr').first();
  await row.locator('input').nth(0).fill('홍길동');
  await row.locator('input').nth(1).fill('90000');
  await row.locator('input').nth(3).fill('100');
  await row.locator('input[type=checkbox]').check();
  await p.click('.rules summary');
  await p.fill('#indirectPct', '0');
  await p.getByLabel('연구재료비 현금(천원)').fill('300000');
  await p.getByLabel('연구활동비 현금(천원)').fill('10000');
  const checks = await p.textContent('#checks');
  check('정상 편성 → 오류 없음', (await p.locator('#checks .error').count()) === 0, checks);
  check('합계 400,000', (await p.textContent('#items tfoot')).includes('400,000'));
  await p.getByLabel('연구수당 현금(천원)').fill('30000');
  check('연구수당 한도 초과 경고', (await p.textContent('#checks .error')).includes('연구수당'));
  await p.getByLabel('연구수당 현금(천원)').fill('');
  check('Pro 판매 준비 중 표시', (await p.textContent('#buy')) === '판매 준비 중' && (await p.locator('#proTools').isHidden()));
  await p.fill('#licenseCode', code);
  await p.click('#activate');
  await p.waitForTimeout(200);
  check('공개키 미설정 시 코드 등록 안 됨', (await p.textContent('#licenseMsg')).includes('준비 중'));
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  check('390px 가로 스크롤 없음', sw <= 390, String(sw));
  await p.reload();
  check('새로고침 후 입력 유지', (await p.inputValue('#gov')) === '300,000' && (await p.locator('#checks .error').count()) === 0);

  // 2) 판매 설정(공개키·스토어) — Pro 등록·엑셀·시나리오
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.RB_CONFIG=${JSON.stringify({ licensePublicKey: pub, storeUrl: 'https://store.example.test/rnd', priceText: '1년 이용권 9,900원' })};` }));
  await p.reload();
  check('구매 버튼 활성', (await p.getAttribute('#buy', 'href')) === 'https://store.example.test/rnd');
  await p.fill('#licenseCode', code.slice(0, -4) + 'AAAA');
  await p.click('#activate'); await p.waitForTimeout(200);
  check('위조 코드 거부', (await p.textContent('#licenseMsg')).includes('유효하지 않은') && (await p.locator('#proTools').isHidden()));
  await p.fill('#licenseCode', code);
  await p.click('#activate'); await p.waitForTimeout(300);
  check('정상 코드 등록 → Pro 기능 표시', await p.locator('#proTools').isVisible());
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xlsx')]);
  const file = await dl.path();
  const head = fs.readFileSync(file).subarray(0, 4);
  check('엑셀 다운로드(.xlsx ZIP)', dl.suggestedFilename().endsWith('.xlsx') && head.readUInt32LE(0) === 0x04034b50, dl.suggestedFilename());
  await p.click('#saveScenario');
  check('시나리오 저장', (await p.textContent('#scenarios')).includes('1안'));
  await p.reload();
  check('재방문 시 이용권 유지', await p.locator('#proTools').isVisible());

  check('콘솔·스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((x) => !x).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
