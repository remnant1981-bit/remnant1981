// E2E: 실제 Chromium에서 앱 전체 흐름 검증.  실행: node tests/coupon-wallet/e2e.js   (playwright 필요)
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  await ctx.grantPermissions(['notifications']);
  const p = await ctx.newPage();
  // 헤드리스 Chromium은 페이지에서 Notification.permission=denied로 보고 → 페이지 경로는 showNotification 호출 여부로 검증.
  // (실제 알림 표시는 아래 periodicsync 테스트가 서비스워커에서 검증)
  await p.addInitScript(() => {
    window.__notes = [];
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    ServiceWorkerRegistration.prototype.showNotification = async function (title, opts) { window.__notes.push({ title, body: opts && opts.body }); };
  });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

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
  await p.waitForFunction(async ids => { const x = await CWStore.loadAll(); return x.coupons.length > 0 && x.coupons.every(c => !ids.includes(c.id)); }, oldIds);
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
  await p.waitForFunction(async () => (await CWStore.loadAll()).coupons.every(c => !c.usedAt));
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
  await p.waitForFunction(async () => (await CWStore.loadAll()).coupons.length === 4);
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
  await p.waitForFunction(async () => (await CWStore.loadAll()).loyalty.some(l => l.name === '스탬프' && l.current === 2));
  check('+1 → 목표 달성 안내 및 완료 섹션 이동', (await text('#toast')).includes('목표 달성') && (await text('#view')).includes('완료 · 마감 지남'));
  await p.locator('.goal', { hasText: '테스트샵' }).locator('[data-action=dec]').click();
  await p.waitForFunction(async () => (await CWStore.loadAll()).loyalty.some(l => l.name === '스탬프' && l.current === 1));
  check('−1: 진행 중으로 복귀', true);
  await p.locator('.goal', { hasText: '테스트샵' }).locator('.item').click();
  await p.waitForSelector('#dlg-loyalty[open]');
  check('적립 수정 폼: 삭제 버튼 노출', await p.locator('#btn-del-loyalty').isVisible());
  await p.click('#btn-del-loyalty'); await p.waitForSelector('#dlg-confirm[open]'); await p.click('#confirm-ok');
  await toastVisible();
  d = await db();
  check('적립 삭제', !d.loyalty.some(l => l.name === '스탬프'));
  await p.click('#toast [data-action=toast-action]');
  await p.waitForFunction(async () => (await CWStore.loadAll()).loyalty.some(l => l.name === '스탬프'));
  check('적립 삭제 실행 취소', true);

  /* --- 적립 연타: 마지막 값까지 정확히 저장 --- */
  await gotoTab('loyalty');
  const tapCard = p.locator('.goal', { hasText: '테스트샵' });
  const curBefore = (await db()).loyalty.find(l => l.name === '스탬프').current;
  for (let i = 0; i < 6; i++) await p.locator('.goal', { hasText: '테스트샵' }).locator('[data-action=inc]').click({ delay: 0 });
  await p.waitForFunction(async n => (await CWStore.loadAll()).loyalty.find(l => l.name === '스탬프').current === n, curBefore + 6);
  check('적립 +1 연타 6회: 화면·DB 값 일치', (await tapCard.locator('b').innerText()).startsWith(String(curBefore + 6)));
  for (let i = 0; i < 6; i++) await p.locator('.goal', { hasText: '테스트샵' }).locator('[data-action=dec]').click();
  await p.waitForFunction(async n => (await CWStore.loadAll()).loyalty.find(l => l.name === '스탬프').current === n, curBefore);

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
  await p.waitForFunction(async () => (await CWStore.loadAll()).coupons.some(c => c.brand === '가져옴'));
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
  await p.waitForFunction(async () => (await CWStore.loadAll()).coupons.some(c => c.id === 'legacy1'));
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

  /* --- 백그라운드 점검(periodicsync) 핸들러 --- */
  try {
    const cdp = await ctx.newCDPSession(p);
    const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', e => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await p.waitForTimeout(500);
    await p.evaluate(async () => { await CWStore.setMeta('lastNotify', ''); (await (await navigator.serviceWorker.ready).getNotifications()).forEach(n => n.close()); });
    await cdp.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin: new URL(base).origin, registrationId: regs[regs.length - 1].registrationId, tag: 'expiry-check' });
    await p.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length > 0, null, { timeout: 8000 });
    check('백그라운드 점검: periodicsync가 SW에서 알림 생성', true);
  } catch (e) { check('백그라운드 점검: periodicsync가 SW에서 알림 생성', false, String(e.message).split('\n')[0]); }

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

  const unexpected = errors.filter(e => !e.includes('QuotaExceededError')); // 저장 실패 테스트에서 의도적으로 주입한 오류는 제외
  check('콘솔 오류·CSP 위반 없음', unexpected.length === 0, unexpected.join(' | '));

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
