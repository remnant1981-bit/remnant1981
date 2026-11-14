// E2E: 실제 Chromium에서 앱 전체 흐름 검증.  실행: node tests/coupon-wallet/e2e.js   (playwright 필요)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'coupon-wallet');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  → ' + detail}`); };
const pad = n => String(n).padStart(2, '0');
const dstr = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ICON = path.join(ROOT, 'icon-192.png');

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'chromium' }); // 전체 Chromium: 알림 권한이 실제처럼 동작 (headless shell은 거부됨)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  await ctx.grantPermissions(['notifications']);
  const p = await ctx.newPage();
  // 헤드리스 Chromium은 페이지에서 Notification.permission=denied로 보고 → 페이지 경로는 showNotification 호출 여부로 검증.
  // (실제 알림 표시는 아래 periodicsync 테스트가 서비스워커에서 검증)
  await p.addInitScript(() => {
    window.__notes = [];
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    // 헤드리스 Chromium에는 BarcodeDetector가 없으므로 스텁 (window.__barcodes로 판독 결과 제어, null이면 판독 실패)
    // 서버 푸시: 헤드리스 Chromium에는 FCM 연결이 없으므로 구독 객체를 흉내 냄 (sessionStorage로 새로고침 사이 유지)
    {
      const mk = ep => ({ endpoint: ep, options: { applicationServerKey: null }, unsubscribe: async () => { sessionStorage.removeItem('fakeSubEp'); window.__unsubscribed = (window.__unsubscribed || 0) + 1; return true; } });
      PushManager.prototype.getSubscription = async function () { const ep = sessionStorage.getItem('fakeSubEp'); return ep ? mk(ep) : null; };
      PushManager.prototype.subscribe = async function (opts) {
        const n = Number(sessionStorage.getItem('fakeSubN') || 0) + 1;
        sessionStorage.setItem('fakeSubN', n);
        const ep = `https://fcm.googleapis.com/fcm/send/e2e-${n}`;
        sessionStorage.setItem('fakeSubEp', ep);
        window.__subscribeCalls = (window.__subscribeCalls || []).concat([{ userVisibleOnly: opts.userVisibleOnly, keyLen: opts.applicationServerKey.length }]);
        return mk(ep);
      };
    }
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['code_128', 'ean_13', 'qr_code']; }
      async detect() { return window.__barcodes === undefined ? [{ format: 'code_128', rawValue: '123456789012' }] : window.__barcodes; }
    };
    ServiceWorkerRegistration.prototype.showNotification = async function (title, opts) { window.__notes.push({ title, body: opts && opts.body }); };
  });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // 주의: waitForFunction(async ...)는 Promise가 항상 참이라 조건을 보지 않고 즉시 통과함. 비동기 조건은 evaluate로 반복 확인
  const waitAsync = async (fn, arg, ms = 9000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await p.evaluate(fn, arg)) return true; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('waitAsync timeout: ' + String(fn).slice(0, 140));
  };
  const text = sel => p.locator(sel).first().innerText();
  const gotoTab = t => p.click(`[data-tab=${t}]`);
  const toastVisible = () => p.waitForSelector('#toast:not([hidden])');
  const dlgClosed = id => p.waitForSelector(id, { state: 'hidden' });
  const db = () => p.evaluate(() => CWStore.loadAll());
  const settle = () => p.waitForFunction(() => !(history.state && history.state.dlg)); // 팝업 닫힘 → history.back() 완료까지
  const fill = (form, name, v) => p.fill(`${form} [name=${name}]`, v);

  await p.goto(base);
  await p.waitForSelector('.empty');
  check('빈 상태: 온보딩 안내 표시', (await text('#view')).includes('시작하기'));

  /* --- 샘플 --- */
  await p.click('[data-action=sample]');
  await p.waitForSelector('.cards');
  let d = await db();
  check('샘플 넣기: 쿠폰 3 · 적립 2', d.coupons.length === 3 && d.loyalty.length === 2);
  const oldIds = d.coupons.map(c => c.id);
  await p.click('[data-action=open-settings]'); await p.click('[data-action=sample]');
  await waitAsync(async ids => { const x = await CWStore.loadAll(); return x.coupons.length > 0 && x.coupons.every(c => !ids.includes(c.id)); }, oldIds);
  d = await db();
  check('샘플 재실행: 중복 없이 교체', d.coupons.length === 3 && d.loyalty.length === 2);
  await settle();

  /* --- 쿠폰 추가(이미지) / 수정 / 이미지 삭제 --- */
  await gotoTab('coupons'); await p.click('#fab');
  await fill('#form-coupon', 'brand', '테스트<b>브랜드');
  await p.click('#form-coupon button[type=submit]');
  check('필수값 누락: 인라인 오류, 팝업 유지', await p.locator('#coupon-error').isVisible() && await p.locator('#dlg-coupon[open]').count() === 1);
  await fill('#form-coupon', 'title', '3천원 할인');
  await fill('#form-coupon', 'value', '3000');
  await fill('#form-coupon', 'expires', dstr(1));
  await fill('#form-coupon', 'code', 'ABCD-1234');
  await p.setInputFiles('#form-coupon [name=image]', ICON);
  await p.waitForSelector('#img-preview img');
  await p.click('#form-coupon button[type=submit]');
  await dlgClosed('#dlg-coupon');
  check('쿠폰 추가: 목록에 표시 + HTML 이스케이프', (await text('#clist')).includes('테스트<b>브랜드') && await p.locator('#clist b').count() === 0);
  d = await db();
  const added = d.coupons.find(c => c.title === '3천원 할인');
  check('쿠폰 저장: IndexedDB에 이미지 포함 저장', added && added.image.startsWith('data:image/') && added.code === 'ABCD-1234');

  await p.click('#clist .item >> nth=0');
  await p.waitForSelector('#dlg-detail[open]');
  check('상세: 바코드 이미지·번호 표시', await p.locator('#detail .code-img img').count() === 1 && (await text('#detail .code-text')) === 'ABCD-1234');
  await p.click('#detail [data-action=edit-coupon]');
  await p.waitForSelector('#dlg-coupon[open]');
  check('수정 폼: 기존 값 채워짐', await p.inputValue('#form-coupon [name=title]') === '3천원 할인' && await p.inputValue('#form-coupon [name=id]') === added.id);
  await fill('#form-coupon', 'title', '5천원 할인');
  await p.click('#form-coupon [data-action=rm-image]');
  await p.click('#form-coupon button[type=submit]');
  await dlgClosed('#dlg-coupon');
  d = await db();
  const edited = d.coupons.find(c => c.id === added.id);
  check('수정 저장: 같은 id로 갱신·이미지 삭제 반영', d.coupons.length === 4 && edited.title === '5천원 할인' && edited.image === '');

  /* --- 검색 --- */
  await p.fill('#q', '올리브');
  check('검색: 일치 항목만 표시', await p.locator('#clist .item').count() === 1 && await p.inputValue('#q') === '올리브');
  await p.fill('#q', '');

  /* --- 사용 완료 / 실행 취소 --- */
  await p.click('#clist .item >> nth=0');
  await p.click('#detail [data-action=use]');
  await p.waitForSelector('#dlg-use[open]');
  await p.fill('#form-use [name=saved]', '4500');
  await p.click('#form-use button[type=submit]');
  await dlgClosed('#dlg-use'); await toastVisible();
  d = await db();
  check('사용 완료: 절약 금액·날짜 기록', d.coupons.some(c => c.usedAt && c.saved === 4500));
  await p.click('#toast [data-action=toast-action]');
  await waitAsync(async () => (await CWStore.loadAll()).coupons.every(c => !c.usedAt));
  check('사용 완료 실행 취소: 원복', true);

  /* --- 삭제 / 실행 취소 --- */
  await p.click('#clist .item >> nth=0');
  await p.click('#detail [data-action=del-coupon]');
  await p.waitForSelector('#dlg-confirm[open]');
  await p.click('#confirm-ok');
  await toastVisible();
  d = await db();
  check('삭제: 확인 후 제거', d.coupons.length === 3);
  await p.click('#toast [data-action=toast-action]');
  await waitAsync(async () => (await CWStore.loadAll()).coupons.length === 4);
  check('삭제 실행 취소: 복구', true);

  /* --- 뒤로가기 --- */
  await p.click('#fab');
  await p.waitForSelector('#dlg-coupon[open]');
  const urlBefore = p.url();
  await p.goBack();
  await dlgClosed('#dlg-coupon');
  check('뒤로가기: 팝업만 닫히고 앱 유지', p.url() === urlBefore && await p.locator('#view').count() === 1);
  await p.click('#fab'); await p.waitForSelector('#dlg-coupon[open]');
  await p.click('#dlg-coupon [data-action=close-dialog]');
  await dlgClosed('#dlg-coupon');
  await p.waitForTimeout(150);
  check('닫기 버튼 후 히스토리 정리(뒤로가기로 이탈하지 않음)', await p.evaluate(() => !(history.state && history.state.dlg)));

  /* --- 적립 --- */
  await gotoTab('loyalty'); await p.click('#fab');
  await fill('#form-loyalty', 'brand', '테스트샵');
  await fill('#form-loyalty', 'name', '스탬프');
  await fill('#form-loyalty', 'current', '1');
  await fill('#form-loyalty', 'target', '2');
  await fill('#form-loyalty', 'deadline', dstr(30));
  await p.click('#form-loyalty button[type=submit]');
  await dlgClosed('#dlg-loyalty');
  check('적립 추가: 진행 중 섹션', (await text('#view')).includes('테스트샵') && (await text('#view')).includes('진행 중'));
  const card = p.locator('.goal', { hasText: '테스트샵' });
  await card.locator('[data-action=inc]').click();
  await waitAsync(async () => (await CWStore.loadAll()).loyalty.some(l => l.name === '스탬프' && l.current === 2));
  check('+1 → 목표 달성 안내 및 완료 섹션 이동', (await text('#toast')).includes('목표 달성') && (await text('#view')).includes('완료 · 마감 지남'));
  await p.locator('.goal', { hasText: '테스트샵' }).locator('[data-action=dec]').click();
  await waitAsync(async () => (await CWStore.loadAll()).loyalty.some(l => l.name === '스탬프' && l.current === 1));
  check('−1: 진행 중으로 복귀', true);
  await p.locator('.goal', { hasText: '테스트샵' }).locator('.item').click();
  await p.waitForSelector('#dlg-loyalty[open]');
  check('적립 수정 폼: 삭제 버튼 노출', await p.locator('#btn-del-loyalty').isVisible());
  await p.click('#btn-del-loyalty'); await p.waitForSelector('#dlg-confirm[open]'); await p.click('#confirm-ok');
  await toastVisible();
  d = await db();
  check('적립 삭제', !d.loyalty.some(l => l.name === '스탬프'));
  await p.click('#toast [data-action=toast-action]');
  await waitAsync(async () => (await CWStore.loadAll()).loyalty.some(l => l.name === '스탬프'));
  check('적립 삭제 실행 취소', true);

  /* --- 적립 연타: 마지막 값까지 정확히 저장 --- */
  await gotoTab('loyalty');
  const tapCard = p.locator('.goal', { hasText: '테스트샵' });
  const curBefore = (await db()).loyalty.find(l => l.name === '스탬프').current;
  for (let i = 0; i < 6; i++) await p.locator('.goal', { hasText: '테스트샵' }).locator('[data-action=inc]').click({ delay: 0 });
  await waitAsync(async n => (await CWStore.loadAll()).loyalty.find(l => l.name === '스탬프').current === n, curBefore + 6);
  check('적립 +1 연타 6회: 화면·DB 값 일치', (await tapCard.locator('b').innerText()).startsWith(String(curBefore + 6)));
  for (let i = 0; i < 6; i++) await p.locator('.goal', { hasText: '테스트샵' }).locator('[data-action=dec]').click();
  await waitAsync(async n => (await CWStore.loadAll()).loyalty.find(l => l.name === '스탬프').current === n, curBefore);

  /* --- 저장 실패: 팝업·입력 유지, 화면 상태 미변경 --- */
  await gotoTab('coupons'); await p.click('#fab'); await p.waitForSelector('#dlg-coupon[open]');
  await fill('#form-coupon', 'brand', '실패테스트'); await fill('#form-coupon', 'title', '저장 안 됨');
  const cntBefore = (await db()).coupons.length;
  await p.evaluate(() => { window.__origPut = CWStore.put; CWStore.put = () => Promise.reject(new Error('QuotaExceededError')); });
  await p.click('#form-coupon button[type=submit]');
  await toastVisible();
  check('저장 실패: 안내 표시 + 팝업·입력 유지', (await text('#toast')).includes('저장 실패') && await p.locator('#dlg-coupon[open]').count() === 1 && await p.inputValue('#form-coupon [name=title]') === '저장 안 됨');
  await p.evaluate(() => { CWStore.put = window.__origPut; });
  check('저장 실패: DB·목록에 반영되지 않음', (await db()).coupons.length === cntBefore && !(await text('#view')).includes('저장 안 됨'));
  await p.click('#form-coupon button[type=submit]');
  await dlgClosed('#dlg-coupon');
  check('저장 실패 후 재시도 성공', (await db()).coupons.length === cntBefore + 1);
  await settle();

  /* --- 기프티콘 자동 인식 (Anthropic API는 목으로 대체) --- */
  const apiCalls = []; let apiMode = 'ok';
  const okPayload = { is_coupon: true, brand: '스타벅스', title: '아이스 아메리카노 T', value: 4700, expires: dstr(20), code: '1234 5678 9012', memo: '전국 매장 사용', confidence: 'high' };
  await ctx.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    apiCalls.push({ url: req.url(), headers: await req.allHeaders(), body: JSON.parse(req.postData() || '{}') });
    const json = { ...cors, 'content-type': 'application/json' };
    if (apiMode === '401') return route.fulfill({ status: 401, headers: json, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    if (apiMode === 'slow') await new Promise(r => setTimeout(r, 900));
    const text = apiMode === 'garbage' ? '죄송하지만 읽을 수 없음' : JSON.stringify(apiMode === 'notcoupon' ? { ...okPayload, is_coupon: false } : okPayload);
    route.fulfill({ status: 200, headers: json, body: JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 } }) });
  });
  const KEY = 'sk-ant-api03-TESTKEY1234';
  const scanStatusText = () => p.locator('#scan-status').innerText();
  const openCouponForm = async () => { await gotoTab('coupons'); await p.click('#fab'); await p.waitForSelector('#dlg-coupon[open]'); };
  const closeCouponForm = async () => { await p.click('#dlg-coupon [data-action=close-dialog]'); await dlgClosed('#dlg-coupon'); await settle(); };
  const scanWith = async () => { await p.setInputFiles('#scan-file', ICON); await p.waitForFunction(() => !document.querySelector('#scan-status').textContent.includes('분석하는 중')); };

  await p.click('[data-action=open-settings]');
  await p.fill('#api-key', 'abc');
  await p.click('[data-action=save-key]');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('형식이 올바르지 않음'));
  check('API 키: 형식이 잘못되면 저장 거부', (await text('#toast')).includes('형식이 올바르지 않음') && !(await p.evaluate(() => CWStore.getMeta('apiKey'))));
  await p.fill('#api-key', KEY);
  await p.click('[data-action=save-key]');
  await p.waitForFunction(() => document.querySelector('#scan-state').textContent.includes('…1234'));
  check('API 키: 저장·마스킹 표시·입력칸 비움', (await p.evaluate(() => CWStore.getMeta('apiKey'))) === KEY && (await p.inputValue('#api-key')) === '' && (await text('#scan-state')).includes('claude-opus-5-5'));
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-action=export]')]);
  check('백업 파일에 API 키가 포함되지 않음', !fs.readFileSync(await dl2.path(), 'utf8').includes('TESTKEY'));
  await p.click('#dlg-settings [data-action=close-dialog]'); await settle();

  await openCouponForm();
  await scanWith();
  check('인식: 폼 자동 입력 (브랜드·상품·금액·유효기간·메모)',
    await p.inputValue('#form-coupon [name=brand]') === '스타벅스' && await p.inputValue('#form-coupon [name=title]') === '아이스 아메리카노 T' &&
    await p.inputValue('#form-coupon [name=value]') === '4700' && await p.inputValue('#form-coupon [name=expires]') === dstr(20) &&
    await p.inputValue('#form-coupon [name=memo]') === '전국 매장 사용');
  check('인식: 번호는 바코드 판독값, 사진 자동 첨부, 완료 안내',
    await p.inputValue('#form-coupon [name=code]') === '123456789012' && await p.locator('#img-preview img').count() === 1 && (await scanStatusText()).includes('인식 완료'));
  const call = apiCalls[0];
  check('요청: Opus 5.5 + 이미지 + 구조화 출력 + 거절 fallback', call && call.url.endsWith('/v1/messages') &&
    call.body.model === 'claude-opus-5-5' && call.body.fallbacks === 'default' && call.headers['anthropic-beta'].includes('server-side-fallback-2026-07-01') &&
    call.body.output_config.format.type === 'json_schema' && call.body.output_config.effort === 'low' && call.body.max_tokens >= 4096, JSON.stringify(call && call.body).slice(0, 300));
  const content0 = call.body.messages[0].content;
  check('요청: base64 이미지 블록 + 시스템 프롬프트, 금지 파라미터 없음',
    content0[0].type === 'image' && content0[0].source.type === 'base64' && content0[0].source.media_type === 'image/png' && content0[0].source.data.length > 100 &&
    typeof call.body.system === 'string' && call.body.system.includes('지시') && !('thinking' in call.body) && !('temperature' in call.body));
  check('요청: 사용자 API 키 헤더(SDK 1.x는 Authorization Bearer)와 브라우저 직접 호출 헤더', call.headers['authorization'] === `Bearer ${KEY}` && call.headers['anthropic-dangerous-direct-browser-access'] === 'true');
  await p.click('#form-coupon button[type=submit]'); await dlgClosed('#dlg-coupon'); await settle();
  d = await db();
  const scanned = d.coupons.find(c => c.title === '아이스 아메리카노 T');
  check('인식 결과 저장: 번호·이미지·메모 포함', scanned && scanned.code === '123456789012' && scanned.value === 4700 && scanned.image.startsWith('data:image/') && scanned.memo === '전국 매장 사용');

  await openCouponForm();
  await p.evaluate(() => { window.__barcodes = [{ format: 'code_128', rawValue: '999999999999' }]; });
  await scanWith();
  check('인식: 바코드와 AI 번호가 다르면 바코드 값 + 경고', await p.inputValue('#form-coupon [name=code]') === '999999999999' && (await scanStatusText()).includes('달라'));
  await p.evaluate(() => { window.__barcodes = undefined; });
  apiMode = 'notcoupon'; await scanWith();
  check('인식: 쿠폰 사진이 아니면 입력하지 않고 안내', (await scanStatusText()).includes('이미지가 아닌 것 같음') && await p.inputValue('#form-coupon [name=brand]') === '스타벅스'); // 앞선 값 유지
  await closeCouponForm();

  await openCouponForm();
  apiMode = '401'; await scanWith();
  check('오류(401): 키 안내 + 바코드 번호는 입력', (await scanStatusText()).includes('API 키가 올바르지 않음') && await p.inputValue('#form-coupon [name=code]') === '123456789012' && await p.inputValue('#form-coupon [name=brand]') === '');
  apiMode = 'garbage'; await scanWith();
  check('오류(응답 해석 실패): 직접 입력 안내', (await scanStatusText()).includes('인식 결과를 읽지 못함'));
  await closeCouponForm();

  // 중도 취소: 응답 전에 팝업을 닫으면 결과를 무시하고 다음 폼은 깨끗해야 함
  await openCouponForm();
  apiMode = 'slow'; await p.setInputFiles('#scan-file', ICON);
  await closeCouponForm();
  await p.waitForTimeout(1300);
  await openCouponForm();
  check('중도 취소: 늦게 온 결과가 다음 폼에 반영되지 않음', await p.inputValue('#form-coupon [name=brand]') === '' && await p.locator('#scan-status').isHidden());
  await closeCouponForm();

  // Haiku: 거절 대체(fallbacks) 미지원 모델은 일반 엔드포인트로 호출
  apiMode = 'ok'; apiCalls.length = 0;
  await p.click('[data-action=open-settings]'); await p.selectOption('#api-model', 'claude-haiku-5-5'); await p.click('[data-action=save-key]');
  await p.waitForFunction(() => document.querySelector('#scan-state').textContent.includes('claude-haiku-5-5'));
  await p.click('#dlg-settings [data-action=close-dialog]'); await settle();
  await openCouponForm(); await scanWith();
  check('모델 변경(Haiku): fallback 베타 헤더·파라미터 없음', apiCalls.length === 1 && !(apiCalls[0].headers['anthropic-beta'] || '').includes('server-side-fallback') && apiCalls[0].body.model === 'claude-haiku-5-5' && !('fallbacks' in apiCalls[0].body));
  await closeCouponForm();

  // 키 삭제 → 바코드만
  apiCalls.length = 0;
  await p.click('[data-action=open-settings]'); await p.click('[data-action=clear-key]'); await p.waitForSelector('#dlg-confirm[open]'); await p.click('#confirm-ok');
  await p.waitForFunction(() => document.querySelector('#scan-state').textContent.includes('미등록'));
  await p.click('#dlg-settings [data-action=close-dialog]'); await settle();
  await openCouponForm(); await scanWith();
  check('키 없음: API 호출 없이 바코드 번호만 입력 + 안내', apiCalls.length === 0 && await p.inputValue('#form-coupon [name=code]') === '123456789012' && (await scanStatusText()).includes('API 키를 등록'));
  await p.evaluate(() => { window.__barcodes = []; });
  await scanWith();
  check('키·바코드 모두 없음: 사진만 첨부 안내', (await scanStatusText()).includes('사진만 첨부') && await p.locator('#img-preview img').count() === 1);
  await p.evaluate(() => { window.__barcodes = undefined; });
  await closeCouponForm();

  /* --- 공유하기로 받기 (Web Share Target) --- */
  await p.evaluate(() => CWStore.setMeta('apiKey', 'sk-ant-api03-TESTKEY1234'));
  apiMode = 'ok'; apiCalls.length = 0;
  const mf = await p.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  check('매니페스트: share_target(POST·multipart·image/*) 등록', mf.share_target && mf.share_target.method === 'POST' && mf.share_target.enctype === 'multipart/form-data' &&
    mf.share_target.params.files[0].name === 'image' && mf.share_target.params.files[0].accept.includes('image/*'));
  // 브라우저가 공유 시 보내는 것과 같은 multipart POST를 서비스워커로 보냄 (303 리다이렉트는 opaqueredirect로 관찰됨)
  const postShare = ({ n = 0, type = 'image/png', fields = {} }) => p.evaluate(async ({ n, type, fields }) => {
    const blob = await (await fetch('icon-192.png')).blob();
    const fd = new FormData();
    for (let i = 0; i < n; i++) fd.append('image', new File([blob], `g${i}.png`, { type }));
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return (await fetch('share-target', { method: 'POST', body: fd, redirect: 'manual' })).type;
  }, { n, type, fields });
  // Blob은 evaluate 결과로 직렬화되지 않으므로 페이지 안에서 요약해서 가져옴
  const pending = () => p.evaluate(async () => { const d = await CWStore.getMeta('pendingShare'); return d ? { items: d.items.map(i => ({ type: i.type, size: i.blob.size, isBlob: i.blob instanceof Blob })), text: d.text } : null; });
  const formReady = () => p.waitForFunction(() => document.querySelector('#dlg-coupon').open && !document.querySelector('#scan-status').textContent.includes('분석하는 중') && !document.querySelector('#scan-status').hidden);
  const sharedTitle = () => p.locator('#coupon-form-title').innerText();
  const saveForm = async () => { await p.click('#form-coupon button[type=submit]'); };

  // 1장: 공유 → 앱이 열리며 자동 인식까지
  const before = (await db()).coupons.length;
  check('공유 수신: 서비스워커가 POST를 받아 리다이렉트', (await postShare({ n: 1 })) === 'opaqueredirect');
  const held = await pending();
  check('공유 수신: 사진이 IndexedDB에 보관됨', held && held.items.length === 1 && held.items[0].type === 'image/png' && held.items[0].size > 0 && held.items[0].isBlob);
  await p.goto(base + '?share=image'); await formReady();
  check('공유 1장: 폼이 열리고 자동 인식·번호·사진 첨부', (await sharedTitle()).includes('공유') && await p.inputValue('#form-coupon [name=brand]') === '스타벅스' &&
    await p.inputValue('#form-coupon [name=code]') === '123456789012' && await p.locator('#img-preview img').count() === 1 && apiCalls.length === 1);
  check('공유 1장: 주소의 share 파라미터 제거', !p.url().includes('share='));
  await saveForm(); await dlgClosed('#dlg-coupon'); await settle();
  check('공유 1장: 저장 후 대기열 비움', (await db()).coupons.length === before + 1 && (await pending()) === null);

  // 2장: 저장하면 바로 다음 사진
  await postShare({ n: 2 }); await p.goto(base + '?share=image'); await formReady();
  check('공유 2장: 첫 폼에 진행 표시(1/2)', (await sharedTitle()).includes('1/2'));
  await saveForm();
  await p.waitForFunction(() => document.querySelector('#dlg-coupon').open && document.querySelector('#coupon-form-title').textContent.includes('2/2'));
  await formReady();
  check('공유 2장: 저장하면 다음 사진(2/2)이 자동으로 열려 인식', apiCalls.length === 3 && await p.inputValue('#form-coupon [name=brand]') === '스타벅스');
  await p.click('#dlg-coupon [data-action=close-dialog]'); await dlgClosed('#dlg-coupon'); await settle();
  check('공유 2장: 마지막 사진을 건너뛰면 대기열 비움·추가 안내 없음', (await db()).coupons.length === before + 2 && (await pending()) === null && !(await text('#toast')).includes('남은 공유 사진'));

  // 건너뛰기 → 이어서 처리 / 앱을 닫았다 열어도 남은 사진 유지
  await postShare({ n: 2 }); await p.goto(base + '?share=image'); await formReady();
  await p.click('#dlg-coupon [data-action=close-dialog]'); await dlgClosed('#dlg-coupon'); await settle();
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('남은 공유 사진 1장'));
  check('건너뛰기: 남은 사진 안내 + 대기열에 1장 유지', (await pending()).items.length === 1);
  await p.goto(base); await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('처리하지 않은 공유 사진 1장'));
  await p.click('#toast [data-action=toast-action]'); await formReady();
  check('앱 재실행 후에도 남은 공유 사진을 이어서 처리', (await sharedTitle()).includes('공유') && await p.inputValue('#form-coupon [name=brand]') === '스타벅스');
  await saveForm(); await dlgClosed('#dlg-coupon'); await settle();
  check('이어서 처리 완료: 대기열 비움', (await pending()) === null && (await db()).coupons.length === before + 3);

  // 글만 공유 / 이미지가 아닌 파일 / 차단·오류
  check('글만 공유: 서비스워커가 보관', (await postShare({ fields: { title: '기프티콘', text: '스타벅스 아메리카노 ~2026-12-31', url: 'https://example.com/g' } })) === 'opaqueredirect');
  await p.goto(base + '?share=text'); await p.waitForSelector('#dlg-coupon[open]');
  const memo = await p.inputValue('#form-coupon [name=memo]');
  check('글만 공유: 메모에 제목·본문·링크를 넣고 직접 입력 안내', memo.includes('기프티콘') && memo.includes('~2026-12-31') && memo.includes('https://example.com/g') && (await text('#toast')).includes('메모에 넣었음') && (await pending()) === null);
  await closeCouponForm();
  await postShare({ n: 1, type: 'text/plain' }); await p.goto(base + '?share=none');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('공유된 내용이 없음'));
  check('이미지가 아닌 파일만 공유: 보관하지 않고 안내', (await pending()) === null && await p.locator('#dlg-coupon[open]').count() === 0);
  await p.goto(base + '?share=blocked');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('공유를 받지 못함'));
  check('차단·오류 상태: 안내 표시', true);

  // 같은 사이트의 다른 앱(/rnd-budget/)은 서비스워커가 캐시·가로채지 않음
  await ctx.route('**/rnd-budget/**', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }, body: 'other-app' }));
  const other = await p.evaluate(async () => (await fetch('rnd-budget/a.txt')).text());
  const cachedOther = await p.evaluate(async () => { for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('rnd-budget')) return true; return false; });
  check('다른 앱 경로(/rnd-budget/): 응답은 그대로, 서비스워커 캐시에 저장 안 됨', other === 'other-app' && !cachedOther);
  await p.evaluate(() => CWStore.setMeta('apiKey', ''));

  /* --- 서버 푸시 (서버는 push-server/src/core.js 실제 코드를 그대로 연결) --- */
  const { handle: pushHandle } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'push-server', 'src', 'core.js')).href);
  const kvStore = new Map();
  const pushKV = {
    async get(k, t) { const v = kvStore.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { kvStore.set(k, String(v)); }, async delete(k) { kvStore.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...kvStore.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name }));
      const st = cursor ? Number(cursor) : 0;
      return { keys: keys.slice(st, st + limit), list_complete: st + limit >= keys.length, cursor: String(st + limit) };
    }
  };
  const pushEnv = { SUBS: pushKV, ALLOWED_ORIGIN: new URL(base).origin, REGISTER_CODE: 'open-sesame', VAPID_SUBJECT: 'https://example.com/' };
  const fcmCalls = []; let pushDown = false;
  const PUSH_SERVER = 'https://coupon-push.test.workers.dev';
  await ctx.route(`${PUSH_SERVER}/**`, async route => {
    if (pushDown) return route.abort();
    const r = route.request();
    const hdrs = await r.allHeaders();
    const request = new Request(r.url(), { method: r.method(), headers: hdrs, body: ['GET', 'HEAD', 'OPTIONS'].includes(r.method()) ? undefined : r.postData() });
    const res = await pushHandle(request, pushEnv, { fetch: async (u, o) => { fcmCalls.push({ u, o }); return new Response(null, { status: 201 }); } });
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  const subs = () => [...kvStore.entries()].filter(([k]) => k.startsWith('sub:')).map(([k, v]) => ({ id: k.slice(4), ...JSON.parse(v) }));
  const until = async (fn, ms = 9000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  const notesNow = () => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ body: n.body, tag: n.tag })));
  const cdpPush = await ctx.newCDPSession(p);
  const pushRegs = [];
  cdpPush.on('ServiceWorker.workerRegistrationUpdated', e => pushRegs.push(...e.registrations));
  cdpPush.on('ServiceWorker.workerErrorReported', e => console.log('SW_ERROR', String(e.errorMessage && e.errorMessage.errorMessage).slice(0, 300)));
  await cdpPush.send('ServiceWorker.enable');
  await p.waitForTimeout(500);
  const deliverPush = () => cdpPush.send('ServiceWorker.deliverPushMessage', { origin: new URL(base).origin, registrationId: pushRegs[pushRegs.length - 1].registrationId, data: '' });
  const openSettings = async () => { await p.click('[data-action=open-settings]'); await p.waitForSelector('#dlg-settings[open]'); };
  const closeSettings = async () => { await p.click('#dlg-settings [data-action=close-dialog]'); await settle(); };
  const clearNotes = () => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach(n => n.close()));

  // 켜기 실패: 입력은 유지되고 안내가 뜸
  await openSettings();
  await p.fill('#push-server', PUSH_SERVER); await p.fill('#push-code', 'wrong');
  await p.click('[data-action=push-on]');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('등록 코드가 올바르지 않'));
  check('서버 푸시: 등록 코드가 틀리면 안내하고 입력값 유지, 서버에 등록 안 됨', await p.inputValue('#push-server') === PUSH_SERVER && await p.inputValue('#push-code') === 'wrong' && subs().length === 0 && (await text('#push-state')).includes('꺼짐'));
  pushDown = true;
  await p.fill('#push-code', 'open-sesame'); await p.click('[data-action=push-on]');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('서버에 연결하지 못함'));
  check('서버 푸시: 서버에 연결할 수 없으면 안내', await p.inputValue('#push-code') === 'open-sesame' && subs().length === 0);
  pushDown = false;

  // 켜기 성공
  await p.selectOption('#push-hour', '9'); await p.click('[data-action=push-on]');
  await p.waitForFunction(() => document.querySelector('#push-state').textContent.includes('켜짐'));
  const s1 = subs();
  check('서버 푸시: 켜면 구독 생성(userVisibleOnly·VAPID 키 65바이트)·서버에 등록', s1.length === 1 && s1[0].endpoint.endsWith('e2e-1') && s1[0].hour === 9 && s1[0].tzOffsetMin === -new Date().getTimezoneOffset());
  const sc = await p.evaluate(() => window.__subscribeCalls);
  check('서버 푸시: PushManager.subscribe 인자', sc.length === 1 && sc[0].userVisibleOnly === true && sc[0].keyLen === 65);
  check('서버 푸시: 상태 표시(켜짐·매일 오전 9시)', (await text('#push-state')).includes('매일 오전 9시'));
  const mine = await p.evaluate(async () => { const d = await CWStore.loadAll(); return { sched: CW.pushSchedule(d), words: [...d.coupons.flatMap(c => [c.brand, c.title, c.code]), ...d.loyalty.flatMap(l => [l.brand, l.name])].filter(w => w && w.length > 1) }; });
  check('서버 푸시: 서버의 알림 날짜가 이 기기 데이터의 계산과 일치', JSON.stringify(s1[0].schedule) === JSON.stringify(mine.sched) && mine.sched.length > 0, JSON.stringify(s1[0].schedule));
  const serverBlob = JSON.stringify([...kvStore.values()]);
  check('개인정보: 서버 저장 내용에 쿠폰·적립 이름/번호가 없음', mine.words.length > 5 && mine.words.every(w => !serverBlob.includes(w)), mine.words.find(w => serverBlob.includes(w)));
  await closeSettings();

  // 데이터가 바뀌면 알림 날짜가 서버에 반영됨
  const tmr = dstr(1);
  await openCouponForm();
  await fill('#form-coupon', 'brand', '푸시시험'); await fill('#form-coupon', 'title', '내일 만료'); await fill('#form-coupon', 'expires', tmr);
  await p.click('#form-coupon button[type=submit]'); await dlgClosed('#dlg-coupon'); await settle();
  check('동기화: 쿠폰을 추가하면 서버의 알림 날짜가 갱신됨', await until(() => subs()[0] && subs()[0].schedule.includes(tmr) && subs()[0].schedule.includes(dstr(-2) < dstr(0) ? dstr(0) : dstr(0))));
  check('동기화: 갱신 후에도 이름은 서버에 없음', !JSON.stringify([...kvStore.values()]).includes('푸시시험'));
  const putsBefore = fcmCalls.length;
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(2600);
  check('동기화: 바뀐 게 없으면 서버 호출을 하지 않음(화면 복귀)', JSON.stringify(subs()[0].schedule) === JSON.stringify(await p.evaluate(async () => CW.pushSchedule(await CWStore.loadAll()))) && fcmCalls.length === putsBefore);

  // 테스트 푸시: 서버가 VAPID 서명으로 전송 → 기기가 수신
  await clearNotes();
  await openSettings(); await p.click('[data-action=push-test]');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('테스트 푸시를 보냈음'));
  check('테스트: 서버가 푸시 서비스로 내용 없는 푸시를 VAPID 인증으로 전송', fcmCalls.length === 1 && fcmCalls[0].u.endsWith('e2e-1') && fcmCalls[0].o.method === 'POST' && fcmCalls[0].o.body === undefined && /^vapid t=.+, k=.+$/.test(fcmCalls[0].o.headers.Authorization));
  await closeSettings();
  await deliverPush();
  check('테스트: 푸시가 도착하면 "연결됨" 알림', await until(async () => (await notesNow()).some(n => n.body.includes('서버 푸시가 연결되었음'))));

  // 실제 신호: 기기 데이터로 알림 문구를 만듦
  await clearNotes(); await deliverPush();
  const urgent = await until(async () => (await notesNow()).find(n => n.tag === 'daily' && n.body.includes('푸시시험') && n.body.includes('내일 만료')));
  check('푸시 수신: 오늘 임박한 항목으로 알림 문구 생성(기기에서 계산)', !!urgent, JSON.stringify(await notesNow()));
  check('푸시 수신: 오늘 알림 기록(lastNotify)', (await db()).meta.lastNotify === dstr(0));

  // 보낼 내용이 없을 때: 브라우저 규칙상 알림은 하나 보여야 하므로 조용히 보였다가 닫힘
  await clearNotes();
  await p.evaluate(async () => { window.__bak = await CWStore.loadAll(); await CWStore.clearAll(); });
  const quiet = deliverPush();
  const sawQuiet = await until(async () => (await notesNow()).some(n => n.body.includes('확인할 항목이 없음')), 3000);
  await quiet;
  const closedAgain = await until(async () => (await notesNow()).every(n => !n.body.includes('확인할 항목이 없음')), 8000); // 서비스워커가 약 4초 뒤 닫음
  check('푸시 수신(내용 없음): 조용한 알림을 보였다가 닫음', sawQuiet && closedAgain);
  await p.evaluate(async () => { await CWStore.batch({ putCoupons: window.__bak.coupons, putLoyalty: window.__bak.loyalty }); });

  // 구독이 사라지면 다시 구독하고 서버에 새로 등록 (옛 등록은 정리)
  await p.evaluate(() => sessionStorage.removeItem('fakeSubEp'));
  await p.reload(); await p.waitForSelector('#view');
  check('복구: 구독이 사라지면 재구독·재등록하고 옛 등록은 서버에서 삭제', await until(() => subs().length === 1 && subs()[0].endpoint.endsWith('e2e-2')));

  // 알림 시각 변경
  await openSettings(); await p.selectOption('#push-hour', '20');
  check('설정: 알림 시각을 바꾸면 서버에 반영', await until(() => subs()[0] && subs()[0].hour === 20));

  // 끄기
  await p.click('[data-action=push-off]');
  await p.waitForFunction(() => document.querySelector('#push-state').textContent.trim() === '꺼짐');
  check('끄기: 서버 등록 삭제·브라우저 구독 해제·상태 꺼짐', subs().length === 0 && (await p.evaluate(() => window.__unsubscribed)) >= 1 && (await p.evaluate(async () => (await CWStore.getMeta('pushCfg')).enabled)) === false);
  await closeSettings();
  await p.evaluate(() => CWStore.setMeta('apiKey', ''));

  /* --- 영속성 --- */
  await settle();
  const countBefore = (await db()).coupons.length;
  await p.reload(); await p.waitForSelector('#view .cards, #view .item, #view .empty');
  check('새로고침 후 데이터 유지', (await db()).coupons.length === countBefore);

  /* --- 설정/백업 --- */
  await p.click('[data-action=open-settings]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-action=export]')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('백업 내보내기: 구조·버전·개수', exported.app === 'coupon-wallet' && exported.coupons.length === countBefore && exported.version);
  await p.waitForFunction(() => document.querySelector('#backup-state').textContent.includes('0일 전'));
  check('백업 기록 표시', true);

  const bad = { coupons: [{ brand: '가져옴', title: '정상', expires: dstr(5) }, { brand: '', title: 'x' }, { brand: '외부이미지', title: 'y', image: 'https://evil.example/a.png' }], loyalty: [{ brand: 'a', name: 'b', target: 3 }, 7] };
  await p.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await p.waitForSelector('#dlg-confirm[open]');
  const msg = await text('#confirm-msg');
  check('가져오기: 확인창에 개수·제외 건수 표시', msg.includes('쿠폰 2개') && msg.includes('2개는 제외'));
  await p.click('#confirm-ok');
  await waitAsync(async () => (await CWStore.loadAll()).coupons.some(c => c.brand === '가져옴'));
  d = await db();
  check('가져오기: 병합(기존 유지) + 외부 이미지 URL 제거', d.coupons.length === countBefore + 2 && d.coupons.find(c => c.brand === '외부이미지').image === '');
  await p.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
  await toastVisible();
  check('가져오기: 깨진 파일은 거부', (await text('#toast')).includes('올바른 백업 파일이 아님'));
  await p.click('#dlg-settings [data-action=close-dialog]');
  await settle();

  /* --- v1.0 localStorage 이전 --- */
  await p.evaluate(() => localStorage.setItem('coupon-wallet-v1', JSON.stringify({ coupons: [{ id: 'legacy1', brand: '구버전', title: '이전 쿠폰', expires: '', value: 1000 }], loyalty: [], lastNotify: '' })));
  await p.reload(); await p.waitForSelector('#view');
  await waitAsync(async () => (await CWStore.loadAll()).coupons.some(c => c.id === 'legacy1'));
  check('마이그레이션: v1.0 데이터 이전 후 원본 삭제', await p.evaluate(() => localStorage.getItem('coupon-wallet-v1') === null));

  /* --- 알림 --- */
  await p.evaluate(async () => { await CWStore.put('coupons', { id: 'n1', brand: '알림', title: '내일 만료', value: 0, expires: (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date(Date.now() + 86400000)), code: '', memo: '', image: '' }); await CWStore.setMeta('lastNotify', ''); });
  await p.reload(); await p.waitForSelector('#view');
  await p.waitForFunction(() => window.__notes.length > 0, null, { timeout: 8000 }).catch(() => {});
  const notes = await p.evaluate(() => window.__notes);
  check('알림: 앱 열 때 임박 항목 1건 호출·내용 정확', notes.length === 1 && notes[0].title === '쿠폰 지갑' && notes[0].body.includes('알림 내일 만료 (D-1)'), JSON.stringify(notes));
  check('알림: 호출 후 lastNotify 기록', (await db()).meta.lastNotify === dstr(0));
  await p.reload(); await p.waitForSelector('#view'); await p.waitForTimeout(800);
  check('알림: 같은 날 재실행 시 중복 호출 없음', (await p.evaluate(() => window.__notes.length)) === 0);

  /* --- 백그라운드 점검(periodicsync) 핸들러: 서비스워커가 실제로 알림을 만드는지 --- */
  try {
    const cdp = await ctx.newCDPSession(p);
    const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', e => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await p.waitForTimeout(500);
    await p.evaluate(async () => {
      (await (await navigator.serviceWorker.ready).getNotifications()).forEach(n => n.close());
      await CWStore.put('coupons', { id: 'periodic1', brand: '정기점검', title: '내일 만료', value: 0, expires: (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date(Date.now() + 86400000)), code: '', memo: '', image: '' });
      await CWStore.setMeta('lastNotify', '');
    });
    await p.waitForTimeout(300);
    await cdp.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin: new URL(base).origin, registrationId: regs[regs.length - 1].registrationId, tag: 'expiry-check' });
    const got = await until(async () => (await notesNow()).find(n => n.tag === 'daily' && n.body.includes('정기점검')));
    check('백그라운드 점검: periodicsync가 SW에서 실제 알림 생성(내용 확인)', !!got, JSON.stringify(await notesNow()));
  } catch (e) { check('백그라운드 점검: periodicsync가 SW에서 실제 알림 생성(내용 확인)', false, String(e.message).split('\n')[0]); }

  /* --- 오프라인 --- */
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('#view .item, #view .cards');
  check('오프라인: 캐시로 화면·데이터 표시', (await db()).coupons.length > 0);
  await ctx.setOffline(false);

  /* --- 레이아웃: 큰 금액이 카드를 넘치지 않음 --- */
  await p.evaluate(async () => { await CWStore.put('coupons', { id: 'big', brand: '큰금액', title: 'x', value: 0, expires: '', code: '', memo: '', image: '', usedAt: new Date().toISOString().slice(0, 10), saved: 123456789 }); });
  await p.reload(); await p.waitForSelector('.cards');
  const numOverflow = () => p.evaluate(() => [...document.querySelectorAll('.stat b')].some(b => b.scrollWidth > b.clientWidth + 1));
  check('레이아웃: 큰 금액(1.2억)이 카드 안에 들어옴', !(await numOverflow()));
  // 폰트마다 글자 폭이 다르므로(CI 러너 등) 넓은 폰트를 흉내 내어 재검증
  await p.addStyleTag({ content: '.stat b { letter-spacing: 3px !important; }' });
  await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  check('레이아웃: 글자 폭이 넓은 폰트에서도 넘침 없음', !(await numOverflow()));
  const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('레이아웃: 가로 스크롤 없음', !hscroll);

  /* --- 키보드 / URL 바로가기 --- */
  await p.focus('#view .item'); await p.keyboard.press('Enter');
  check('키보드: Enter로 카드 열기', (await p.locator('#dlg-detail[open], #dlg-loyalty[open]').count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.goto(base + '?add=coupon');
  await p.waitForSelector('#dlg-coupon[open]');
  check('바로가기(?add=coupon): 쿠폰 추가 폼 열림, 주소 정리', !p.url().includes('add='));
  await p.goto(base + '?tab=loyalty'); await p.waitForSelector('.tabs button.on');
  check('바로가기(?tab=loyalty): 적립 탭', (await text('.tabs button.on')) === '적립');

  const unexpected = errors.filter(e => !e.includes('QuotaExceededError') && !e.includes('status of 401') && !e.includes('net::ERR_FAILED')); // 저장 실패 테스트에서 의도적으로 주입한 오류는 제외
  check('콘솔 오류·CSP 위반 없음', unexpected.length === 0, unexpected.join(' | '));

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
