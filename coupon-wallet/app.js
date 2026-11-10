'use strict';

/* ========== 상태 ========== */
const LEGACY_KEY = 'coupon-wallet-v1'; // v1.0 (localStorage) → IndexedDB 이전용
const DEFAULT_BRANDS = ['스타벅스', '올리브영', 'CU', 'GS25', '세븐일레븐', '배달의민족', '쿠팡', '네이버', 'T멤버십', 'KT 멤버십'];
let state = { coupons: [], loyalty: [], meta: { lastNotify: '', lastBackup: '' } };
const ui = { tab: 'home', status: 'active', brand: '', q: '' };
let pendingImage;          // undefined: 변경 없음 / null: 삭제 / string: 새 이미지
let periodic = 'unknown';  // 백그라운드 점검 등록 상태: unknown | on | off
let wake = null;

/* ========== 유틸 ========== */
const $ = (s, r = document) => r.querySelector(s);
const field = (f, n) => f.elements.namedItem(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const upsert = (arr, rec) => { const i = arr.findIndex(x => x.id === rec.id); i >= 0 ? (arr[i] = rec) : arr.push(rec); };
const without = (rec, ...keys) => { const o = { ...rec }; keys.forEach(k => delete o[k]); return o; };

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" data-action="toast-action">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  toast.fn = action ? action.fn : null;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; toast.fn = null; }, action ? 6000 : 2600);
}

// 저장소 작업 래퍼: 성공 true / 실패 시 안내 후 false (호출부가 화면 상태를 되돌리거나 입력을 유지)
async function save(op) {
  try { await op(); return true; }
  catch (e) { console.error(e); toast('저장 실패: 저장 공간이 부족하거나 브라우저가 저장을 막고 있음'); return false; }
}

async function reload() {
  const d = await CWStore.loadAll();
  state = { coupons: d.coupons, loyalty: d.loyalty, meta: d.meta };
}

/* ========== 다이얼로그 (뒤로가기 연동) ========== */
const anyOpen = () => !!document.querySelector('dialog[open]');
function openDlg(d) {
  if (!d.open) d.showModal();
  if (!(history.state && history.state.dlg)) history.pushState({ dlg: true }, '');
}
function closeAll() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
// 폰의 뒤로가기 = 열린 팝업 닫기 (앱 종료 방지)
window.addEventListener('popstate', closeAll);
document.addEventListener('close', e => {
  if (e.target.tagName !== 'DIALOG') return;
  if (!anyOpen() && history.state && history.state.dlg) history.back();
}, true);
$('#dlg-detail').addEventListener('close', unlockScreen);

function askConfirm(msg, okLabel = '확인') {
  return new Promise(resolve => {
    const d = $('#dlg-confirm');
    $('#confirm-msg').textContent = msg;
    $('#confirm-ok').textContent = okLabel;
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      d.removeEventListener('close', onClose); d.removeEventListener('click', onClick);
      if (d.open) d.close();
      resolve(v);
    };
    const onClose = () => finish(false);
    const onClick = e => { const b = e.target.closest('[data-confirm]'); if (b) finish(b.dataset.confirm === '1'); };
    d.addEventListener('close', onClose); d.addEventListener('click', onClick);
    openDlg(d);
  });
}

function formError(id, msg) {
  const el = $('#' + id);
  el.textContent = msg || ''; el.hidden = !msg;
}

async function lockScreen() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* 미지원/거부 무시 */ } }
function unlockScreen() { try { if (wake) wake.release(); } catch (e) { /* 무시 */ } wake = null; }

/* ========== 렌더 ========== */
function render() {
  const T = CW.today();
  document.querySelectorAll('.tabs button').forEach(b => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('on', on);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  $('#title').textContent = { home: '홈', coupons: '쿠폰', loyalty: '적립' }[ui.tab];
  $('#view').innerHTML = { home: renderHome, coupons: renderCoupons, loyalty: renderLoyalty }[ui.tab](T);
  const used = [...state.coupons, ...state.loyalty].map(x => x.brand);
  $('#brands').innerHTML = [...new Set([...used, ...DEFAULT_BRANDS])].map(b => `<option value="${esc(b)}">`).join('');
}

function couponItem(c, T) {
  const st = CW.couponStatus(c, T);
  const d = CW.daysLeft(c, T);
  const badge = st === 'used' ? '<span class="badge mute">사용 완료</span>'
    : st === 'expired' ? '<span class="badge bad">만료</span>'
    : `<span class="badge ${CW.ddayClass(d)}">${CW.ddayLabel(d)}</span>`;
  const meta = [c.expires ? `~${c.expires}` : '', c.value ? CW.won(c.value) : '', c.image ? '🖼' : ''].filter(Boolean).join(' · ');
  return `<div class="item" role="button" tabindex="0" data-action="detail" data-id="${esc(c.id)}">
    <div class="l1"><div><div class="brand">${esc(c.brand)}</div><div class="name">${esc(c.title)}</div></div>${badge}</div>
    ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div>`;
}

function goalItem(l, T) {
  const p = CW.pace(l, T);
  const pct = Math.min(100, Math.round((l.current / l.target) * 100));
  const id = esc(l.id), nm = esc(`${l.brand} ${l.name}`);
  return `<div class="goal">
    <div class="item" role="button" tabindex="0" data-action="edit-loyalty" data-id="${id}">
      <div class="l1"><div><div class="brand">${esc(l.brand)}</div><div class="name">${esc(l.name)}</div></div>
        <b>${l.current} / ${l.target}</b></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${l.target}" aria-valuenow="${l.current}"><i style="width:${pct}%"></i></div>
      <div class="meta ${p.cls}">${esc(p.text)}${l.reward ? ` · 🎁 ${esc(l.reward)}` : ''}</div>
    </div>
    <div class="step">
      <button type="button" data-action="dec" data-id="${id}" aria-label="${nm} 1 감소">− 1</button>
      <button type="button" data-action="inc" data-id="${id}" aria-label="${nm} 1 증가">+ 1</button>
    </div></div>`;
}

const byDeadline = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999');

function renderHome(T) {
  if (!state.coupons.length && !state.loyalty.length) {
    return `<div class="empty">아직 등록된 항목이 없음
      <div class="row"><button class="primary" data-action="add-coupon">쿠폰 추가</button>
      <button class="ghost" data-action="sample">샘플 데이터 넣기</button></div></div>
      <div class="onboard"><b>시작하기</b><ol>
        <li>쿠폰·기프티콘의 만료일을 등록하면 임박 시 알려 줌</li>
        <li>스타벅스 별, 프리퀀시처럼 쌓아 가는 것은 <b>적립</b> 탭에 등록</li>
        <li>설정(⋯)에서 알림 허용과 백업을 켜 두기</li></ol></div>`;
  }
  const s = CW.stats(state, T);
  const soon = state.coupons.filter(c => CW.couponStatus(c, T) === 'active' && CW.daysLeft(c, T) !== null && CW.daysLeft(c, T) <= 7)
    .sort((a, b) => a.expires.localeCompare(b.expires));
  const goals = state.loyalty.filter(l => CW.loyaltyState(l, T) === 'active').sort(byDeadline);
  const sub = [`누적 절약 ${CW.won(s.total)}`, s.rate === null ? '' : `사용률 ${s.rate}%`].filter(Boolean).join(' · ');
  return `
    <div class="cards">
      <div class="stat"><b>${s.active}</b><span>사용 가능 쿠폰</span></div>
      <div class="stat"><b class="ok">${CW.wonCompact(s.saved)}</b><span>이번 달 절약</span></div>
      <div class="stat"><b class="${s.missed ? 'bad' : ''}">${CW.wonCompact(s.missed)}</b><span>이번 달 놓침</span></div>
    </div>
    <p class="substat">${esc(sub)}</p>
    <h2>곧 만료 (7일 이내)</h2>
    ${soon.length ? soon.map(c => couponItem(c, T)).join('') : '<div class="empty">임박한 쿠폰 없음</div>'}
    <h2>적립 진행</h2>
    ${goals.length ? goals.map(l => goalItem(l, T)).join('') : '<div class="empty">진행 중인 적립 없음</div>'}`;
}

function couponListHTML(T) {
  const q = ui.q.trim().toLowerCase();
  const list = state.coupons
    .filter(c => CW.couponStatus(c, T) === ui.status && (!ui.brand || c.brand === ui.brand))
    .filter(c => !q || [c.brand, c.title, c.code, c.memo].join(' ').toLowerCase().includes(q));
  list.sort((a, b) => ui.status === 'active'
    ? (a.expires || '9999').localeCompare(b.expires || '9999')
    : (b.usedAt || b.expires || '').localeCompare(a.usedAt || a.expires || ''));
  return list.length ? list.map(c => couponItem(c, T)).join('') : '<div class="empty">해당하는 쿠폰 없음</div>';
}

function renderCoupons(T) {
  const brands = [...new Set(state.coupons.map(c => c.brand))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (ui.brand && !brands.includes(ui.brand)) ui.brand = '';
  const scope = state.coupons.filter(c => !ui.brand || c.brand === ui.brand);
  const n = st => scope.filter(c => CW.couponStatus(c, T) === st).length;
  const chip = (v, label, on, act) => `<button type="button" class="${on ? 'on' : ''}" data-action="${act}" data-v="${esc(v)}">${esc(label)}</button>`;
  return `
    <input class="search" id="q" type="search" placeholder="브랜드·혜택·번호 검색" value="${esc(ui.q)}" aria-label="쿠폰 검색" autocomplete="off">
    <div class="filters">
      ${chip('active', `사용 가능 ${n('active')}`, ui.status === 'active', 'f-status')}
      ${chip('used', `사용 완료 ${n('used')}`, ui.status === 'used', 'f-status')}
      ${chip('expired', `만료 ${n('expired')}`, ui.status === 'expired', 'f-status')}
    </div>
    ${brands.length ? `<div class="filters">${chip('', '전체', !ui.brand, 'f-brand')}${brands.map(b => chip(b, b, ui.brand === b, 'f-brand')).join('')}</div>` : ''}
    <div id="clist">${couponListHTML(T)}</div>`;
}

function renderLoyalty(T) {
  const act = [], past = [];
  state.loyalty.forEach(l => (CW.loyaltyState(l, T) === 'active' ? act : past).push(l));
  act.sort(byDeadline);
  past.sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''));
  if (!act.length && !past.length) return '<div class="empty">등록된 적립 항목 없음<br>＋ 버튼으로 추가</div>';
  return (act.length ? `<h2>진행 중</h2>${act.map(l => goalItem(l, T)).join('')}` : '')
    + (past.length ? `<h2>완료 · 마감 지남</h2>${past.map(l => goalItem(l, T)).join('')}` : '');
}

/* ========== 이미지 ========== */
const fileToDataURL = f => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f);
});
function compressImage(file, max = 1280, q = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}
// 작은 이미지는 원본 유지(바코드 선명도), 큰 이미지만 축소
const readImage = f => (f.size <= 400 * 1024 && /^image\/(jpeg|png|webp)$/.test(f.type) ? fileToDataURL(f) : compressImage(f));
function showPreview(src) {
  $('#img-preview').innerHTML = src ? `<img src="${esc(src)}" alt="미리보기"><button type="button" data-action="rm-image">이미지 삭제</button>` : '';
}

/* ========== 폼 열기 ========== */
function openCoupon(c) {
  const f = $('#form-coupon');
  f.reset(); formError('coupon-error');
  pendingImage = undefined;
  $('#coupon-form-title').textContent = c ? '쿠폰 수정' : '쿠폰 추가';
  field(f, 'id').value = c ? c.id : '';
  field(f, 'brand').value = c ? c.brand : ui.brand;
  field(f, 'title').value = c ? c.title : '';
  field(f, 'value').value = c && c.value ? c.value : '';
  field(f, 'expires').value = c ? c.expires : '';
  field(f, 'code').value = c ? c.code : '';
  field(f, 'memo').value = c ? c.memo : '';
  showPreview(c ? c.image : '');
  openDlg($('#dlg-coupon'));
}
function openLoyalty(l) {
  const f = $('#form-loyalty');
  f.reset(); formError('loyalty-error');
  $('#loyalty-form-title').textContent = l ? '적립 수정' : '적립 추가';
  field(f, 'id').value = l ? l.id : '';
  field(f, 'brand').value = l ? l.brand : '';
  field(f, 'name').value = l ? l.name : '';
  field(f, 'current').value = l ? l.current : 0;
  field(f, 'target').value = l ? l.target : '';
  field(f, 'deadline').value = l ? l.deadline : '';
  field(f, 'reward').value = l ? l.reward : '';
  field(f, 'memo').value = l ? l.memo : '';
  $('#btn-del-loyalty').hidden = !l;
  openDlg($('#dlg-loyalty'));
}
function openDetail(id) {
  const c = state.coupons.find(x => x.id === id);
  if (!c) return;
  const T = CW.today();
  const st = CW.couponStatus(c, T), d = CW.daysLeft(c, T);
  const meta = st === 'used' ? `사용 완료 ${c.usedAt} · 절약 ${CW.won(c.saved)}`
    : st === 'expired' ? `만료됨 (${c.expires})`
    : [CW.ddayLabel(d), c.expires ? `~${c.expires}` : '', c.value ? CW.won(c.value) : ''].filter(Boolean).join(' · ');
  $('#detail').innerHTML = `
    <div class="brand">${esc(c.brand)}</div>
    <h3>${esc(c.title)}</h3>
    <div class="meta">${esc(meta)}</div>
    ${c.image ? `<div class="code-img"><img src="${esc(c.image)}" alt="바코드"></div>` : ''}
    ${c.code ? `<div class="code-text">${esc(c.code)}</div>` : ''}
    ${c.memo ? `<p class="hint">${esc(c.memo)}</p>` : ''}
    <div class="row">
      <button type="button" class="ghost danger" data-action="del-coupon" data-id="${esc(c.id)}">삭제</button>
      <button type="button" class="ghost" data-action="edit-coupon" data-id="${esc(c.id)}">수정</button>
      ${st === 'used'
        ? `<button type="button" class="primary" data-action="unuse" data-id="${esc(c.id)}">사용 취소</button>`
        : `<button type="button" class="primary" data-action="use" data-id="${esc(c.id)}">사용 완료</button>`}
    </div>
    <div class="row"><button type="button" class="ghost" data-action="close-dialog">닫기</button></div>`;
  openDlg($('#dlg-detail'));
  if (st === 'active' && (c.image || c.code)) lockScreen(); // 매장 스캔 중 화면 꺼짐 방지
}

/* ========== 저장 동작 ========== */
async function removeCoupon(id) {
  const c = state.coupons.find(x => x.id === id);
  if (!c || !(await save(() => CWStore.remove('coupons', id)))) return;
  state.coupons = state.coupons.filter(x => x.id !== id);
  closeAll(); render();
  toast('삭제함', { label: '실행 취소', fn: async () => {
    if (await save(() => CWStore.put('coupons', c))) { state.coupons.push(c); render(); }
  } });
}
async function removeLoyalty(id) {
  const l = state.loyalty.find(x => x.id === id);
  if (!l || !(await save(() => CWStore.remove('loyalty', id)))) return;
  state.loyalty = state.loyalty.filter(x => x.id !== id);
  closeAll(); render();
  toast('삭제함', { label: '실행 취소', fn: async () => {
    if (await save(() => CWStore.put('loyalty', l))) { state.loyalty.push(l); render(); }
  } });
}

async function addSamples() {
  const T = CW.today();
  const off = n => { const d = CW.parse(T); d.setDate(d.getDate() + n); return CW.toStr(d); };
  const mk = (extra) => ({ id: CW.uid(), sample: true, value: 0, expires: '', code: '', memo: '샘플', image: '', ...extra });
  const coupons = [
    mk({ brand: '스타벅스', title: '아메리카노 T 1잔', value: 4700, expires: off(2), code: '1234 5678 9012' }),
    mk({ brand: '올리브영', title: '10% 할인 (최대 5천원)', value: 5000, expires: off(12) }),
    mk({ brand: 'CU', title: '모바일 상품권 3천원', value: 3000, expires: off(-3) })
  ];
  const loyalty = [
    { id: CW.uid(), sample: true, brand: '스타벅스', name: '프리퀀시 (샘플)', current: 6, target: 17, deadline: off(60), reward: '증정품', memo: '' },
    { id: CW.uid(), sample: true, brand: '스타벅스', name: '등급 유지 별 (샘플)', current: 267, target: 300, deadline: '', reward: 'Gold 유지', memo: '' }
  ];
  const ok = await save(() => CWStore.batch({
    delCoupons: state.coupons.filter(x => x.sample).map(x => x.id),
    delLoyalty: state.loyalty.filter(x => x.sample).map(x => x.id),
    putCoupons: coupons, putLoyalty: loyalty
  }));
  if (!ok) { await reload(); render(); return; }
  state.coupons = [...state.coupons.filter(x => !x.sample), ...coupons];
  state.loyalty = [...state.loyalty.filter(x => !x.sample), ...loyalty];
  closeAll(); render(); toast('샘플을 넣음 (다시 누르면 샘플만 교체됨)');
}

function exportData() {
  const payload = { app: 'coupon-wallet', version: CW.VERSION, exportedAt: new Date().toISOString(), coupons: state.coupons, loyalty: state.loyalty };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  a.download = `coupon-wallet-${CW.today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const t = CW.today();
  save(() => CWStore.setMeta('lastBackup', t)).then(ok => { if (ok) { state.meta.lastBackup = t; refreshSettings(); } });
  toast('백업 파일을 저장함');
}

async function importData(file) {
  if (file.size > 60 * 1024 * 1024) return toast('파일이 너무 큼');
  let data;
  try { data = CW.normalizeBackup(JSON.parse(await file.text())); } catch (e) { data = null; }
  if (!data) return toast('올바른 백업 파일이 아님');
  const msg = `쿠폰 ${data.coupons.length}개 · 적립 ${data.loyalty.length}개를 불러옴.\n같은 항목은 덮어쓰고 나머지는 그대로 유지함.${data.dropped ? `\n형식 오류 ${data.dropped}개는 제외됨.` : ''}`;
  if (!(await askConfirm(msg, '불러오기'))) return;
  const ok = await save(() => CWStore.batch({ putCoupons: data.coupons, putLoyalty: data.loyalty }));
  await reload(); render();
  if (ok) toast('불러오기 완료');
}

/* ========== 알림 / 설정 정보 ========== */
async function maybeNotify() {
  if (!('serviceWorker' in navigator)) return;
  try { await CWStore.checkAndNotify(await navigator.serviceWorker.ready); } catch (e) { /* 알림 실패는 무시 */ }
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) { periodic = 'off'; return; }
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') { periodic = 'off'; return; }
    await reg.periodicSync.register('expiry-check', { minInterval: 12 * 3600 * 1000 });
    periodic = 'on';
  } catch (e) { periodic = 'off'; }
}
async function refreshSettings() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notify-state').textContent = {
    granted: '알림 허용됨', denied: '알림 차단됨 (브라우저 사이트 설정에서 변경 필요)', default: '알림 미설정', unsupported: '이 브라우저는 알림 미지원'
  }[perm] + (periodic === 'on' ? ' · 백그라운드 점검 켜짐' : periodic === 'off' ? ' · 백그라운드 점검 사용 불가(앱 열 때만 알림)' : '');
  const lb = state.meta.lastBackup;
  $('#backup-state').textContent = lb ? `마지막 백업: ${lb} (${CW.dayDiff(lb, CW.today())}일 전)` : '백업한 적 없음';
  $('#ver').textContent = `버전 ${CW.VERSION}`;
  try {
    const est = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted();
    $('#storage-state').textContent = `저장소 사용 ${(est.usage / 1048576).toFixed(1)}MB · 영구 저장 ${persisted ? '허용됨' : '미허용(브라우저가 공간 부족 시 삭제할 수 있음)'}`;
  } catch (e) { $('#storage-state').textContent = ''; }
}

/* ========== 이벤트 ========== */
document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action: a, id, v } = el.dataset;

  switch (a) {
    case 'add': ui.tab === 'loyalty' ? openLoyalty() : openCoupon(); break;
    case 'add-coupon': openCoupon(); break;
    case 'close-dialog': el.closest('dialog').close(); break;
    case 'open-settings': openDlg($('#dlg-settings')); refreshSettings(); break;
    case 'detail': openDetail(id); break;
    case 'edit-coupon': { const c = state.coupons.find(x => x.id === id); closeAll(); openCoupon(c); break; }
    case 'edit-loyalty': openLoyalty(state.loyalty.find(x => x.id === id)); break;
    case 'rm-image': pendingImage = null; showPreview(''); field($('#form-coupon'), 'image').value = ''; break;
    case 'f-status': ui.status = v; render(); break;
    case 'f-brand': ui.brand = v; render(); break;
    case 'toast-action': { const fn = toast.fn; $('#toast').hidden = true; toast.fn = null; if (fn) fn(); break; }

    case 'use': {
      const c = state.coupons.find(x => x.id === id);
      const f = $('#form-use');
      field(f, 'id').value = id;
      field(f, 'saved').value = c.value || '';
      $('#use-title').textContent = `${c.brand} 사용 완료`;
      closeAll(); openDlg($('#dlg-use'));
      field(f, 'saved').focus();
      break;
    }
    case 'unuse': {
      const c = state.coupons.find(x => x.id === id);
      const rec = without(c, 'usedAt', 'saved');
      if (await save(() => CWStore.put('coupons', rec))) { upsert(state.coupons, rec); closeAll(); render(); toast('사용 취소함'); }
      break;
    }
    case 'del-coupon': {
      const c = state.coupons.find(x => x.id === id);
      if (await askConfirm(`"${c.brand} ${c.title}" 쿠폰을 삭제?`, '삭제')) removeCoupon(id);
      break;
    }
    case 'del-loyalty': {
      const id2 = field($('#form-loyalty'), 'id').value;
      const l = state.loyalty.find(x => x.id === id2);
      if (l && await askConfirm(`"${l.brand} ${l.name}" 항목을 삭제?`, '삭제')) removeLoyalty(id2);
      break;
    }
    case 'inc': case 'dec': {
      const l = state.loyalty.find(x => x.id === id);
      const before = l.current;
      l.current = Math.max(0, before + (a === 'inc' ? 1 : -1));
      if (l.current === before) break;
      render();
      if (!(await save(() => CWStore.put('loyalty', l)))) { l.current = before; render(); break; }
      if (a === 'inc' && before < l.target && l.current >= l.target) { toast('🎉 목표 달성!'); if (navigator.vibrate) navigator.vibrate(120); }
      break;
    }
    case 'enable-notify':
      if (!('Notification' in window)) { toast('알림 미지원 브라우저'); break; }
      await Notification.requestPermission();
      await registerPeriodic(); await maybeNotify(); refreshSettings();
      break;
    case 'export': exportData(); break;
    case 'sample': await addSamples(); break;
    case 'wipe':
      if (await askConfirm('모든 쿠폰과 적립 데이터를 삭제. 되돌릴 수 없음.\n먼저 백업을 권장함.', '전체 삭제')) {
        if (await save(() => CWStore.clearAll())) { state.coupons = []; state.loyalty = []; closeAll(); render(); toast('전체 삭제함'); }
      }
      break;
  }
});

// 키보드(Enter/Space)로 카드 열기
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
});

// 검색: 목록만 갱신해 입력 포커스 유지
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  ui.q = e.target.value;
  $('#clist').innerHTML = couponListHTML(CW.today());
});

field($('#form-coupon'), 'image').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { pendingImage = await readImage(file); showPreview(pendingImage); } catch (err) { toast('이미지를 읽지 못함'); }
});

$('#form-coupon').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const brand = field(f, 'brand').value.trim(), title = field(f, 'title').value.trim();
  if (!brand || !title) return formError('coupon-error', '브랜드와 혜택을 입력해 주세요');
  const id = field(f, 'id').value;
  const existing = id ? state.coupons.find(c => c.id === id) : null;
  const rec = CW.normalizeCoupon({
    ...(existing || {}), id: existing ? existing.id : CW.uid(),
    brand, title, value: field(f, 'value').value, expires: field(f, 'expires').value,
    code: field(f, 'code').value, memo: field(f, 'memo').value,
    image: pendingImage === undefined ? (existing ? existing.image : '') : (pendingImage || '')
  });
  if (!rec) return formError('coupon-error', '입력값을 확인해 주세요');
  // 실패하면 팝업을 닫지 않아 입력 내용을 유지함
  if (!(await save(() => CWStore.put('coupons', rec)))) return;
  const dup = rec.code && state.coupons.some(c => c.id !== rec.id && c.brand === rec.brand && c.code === rec.code);
  upsert(state.coupons, rec);
  ui.tab = 'coupons'; ui.status = CW.couponStatus(rec); ui.brand = ''; ui.q = '';
  closeAll(); render();
  toast(dup ? '저장함 (같은 번호의 쿠폰이 이미 있음)' : '저장함');
});

$('#form-loyalty').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const id = field(f, 'id').value;
  const existing = id ? state.loyalty.find(l => l.id === id) : null;
  const rec = CW.normalizeLoyalty({
    ...(existing || {}), id: existing ? existing.id : CW.uid(),
    brand: field(f, 'brand').value, name: field(f, 'name').value,
    current: field(f, 'current').value, target: field(f, 'target').value,
    deadline: field(f, 'deadline').value, reward: field(f, 'reward').value, memo: field(f, 'memo').value
  });
  if (!rec) return formError('loyalty-error', '브랜드와 항목을 입력해 주세요');
  if (!field(f, 'target').value || Number(field(f, 'target').value) < 1) return formError('loyalty-error', '목표 수량을 1 이상으로 입력해 주세요');
  if (!(await save(() => CWStore.put('loyalty', rec)))) return;
  upsert(state.loyalty, rec);
  ui.tab = 'loyalty';
  closeAll(); render(); toast('저장함');
});

$('#form-use').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const c = state.coupons.find(x => x.id === field(f, 'id').value);
  if (!c) return closeAll();
  const rec = { ...c, usedAt: CW.today(), saved: Math.round(Math.max(0, Number(field(f, 'saved').value) || 0)) };
  if (!(await save(() => CWStore.put('coupons', rec)))) return;
  upsert(state.coupons, rec);
  closeAll(); render();
  toast(`사용 완료 · ${CW.won(rec.saved)} 절약`, { label: '실행 취소', fn: async () => {
    const back = without(rec, 'usedAt', 'saved');
    if (await save(() => CWStore.put('coupons', back))) { upsert(state.coupons, back); render(); }
  } });
});

$('#import-file').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

// 앱이 백그라운드에서 돌아오면 D-day를 다시 계산하고 알림 점검
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); maybeNotify(); } });
window.addEventListener('error', () => toast('예기치 못한 오류가 발생함. 새로고침 후에도 반복되면 알려 주세요'));
window.addEventListener('unhandledrejection', e => console.error(e.reason));

/* ========== 시작 ========== */
// v1.0 데이터(localStorage)를 IndexedDB로 1회 이전. 이전이 확인된 뒤에만 원본을 지움
async function migrateLegacy() {
  let raw;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch (e) { return; }
  if (!raw) return;
  try {
    const data = CW.normalizeBackup(JSON.parse(raw));
    if (data) await CWStore.batch({ putCoupons: data.coupons, putLoyalty: data.loyalty });
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) { console.error('migration failed', e); }
}

async function init() {
  if (history.state && history.state.dlg) history.replaceState(null, ''); // 새로고침 후 남은 팝업 기록 정리
  try {
    await CWStore.open();
    await migrateLegacy();
    await reload();
  } catch (e) {
    console.error(e);
    toast('이 브라우저에서는 데이터를 저장할 수 없음 (사생활 보호 모드인지 확인)');
  }
  const p = new URLSearchParams(location.search);
  if (['home', 'coupons', 'loyalty'].includes(p.get('tab'))) ui.tab = p.get('tab');
  render();
  if (p.get('add') === 'coupon') openCoupon();
  if (p.has('add') || p.has('tab')) history.replaceState(history.state, '', location.pathname);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 무시 */ }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(registerPeriodic).catch(() => {});
    maybeNotify();
  }
}
init();
