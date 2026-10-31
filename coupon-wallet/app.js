'use strict';

/* ---------- 상태/저장 ---------- */
const KEY = 'coupon-wallet-v1';
const DEFAULT_BRANDS = ['스타벅스', '올리브영', 'CU', 'GS25', '세븐일레븐', '배달의민족', '쿠팡', '네이버', 'T멤버십', 'KT 멤버십'];
let state = load();
const ui = { tab: 'home', status: 'active', brand: '' };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.coupons) && Array.isArray(s.loyalty)) return s;
  } catch (e) { /* 무시 */ }
  return { coupons: [], loyalty: [], lastNotify: '' };
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    toast('저장 실패: 저장 공간 부족. 이미지 수를 줄이거나 백업 후 정리 필요');
    return false;
  }
}

/* ---------- 유틸 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toStr(new Date());
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const won = n => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthOf = s => (s || '').slice(0, 7);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- 도메인 로직 ---------- */
function couponStatus(c) {
  if (c.usedAt) return 'used';
  if (c.expires && c.expires < today()) return 'expired';
  return 'active';
}
function daysLeft(c) { return c.expires ? dayDiff(today(), c.expires) : null; }
function ddayLabel(d) { return d === null ? '기한 없음' : d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : `D+${-d}`; }
function ddayClass(d) { return d === null ? 'mute' : d <= 1 ? 'bad' : d <= 7 ? 'warn' : ''; }

function pace(l) {
  const rem = Math.max(0, l.target - l.current);
  if (rem === 0) return { cls: 'ok', text: '목표 달성 🎉' };
  if (!l.deadline) return { cls: '', text: `${rem} 남음` };
  const left = dayDiff(today(), l.deadline);
  if (left < 0) return { cls: 'bad', text: `마감 지남 · ${rem} 미달` };
  const avail = left + 1; // 오늘 포함
  const perWeek = rem / (avail / 7);
  if (rem > avail) return { cls: 'bad', text: `D-${left} · ${rem} 남음 · 하루 1개로도 부족` };
  return { cls: perWeek > 3.5 ? 'warn' : '', text: `D-${left} · ${rem} 남음 · 주 ${perWeek.toFixed(1)}개 필요` };
}

function stats() {
  const m = monthOf(today());
  const active = state.coupons.filter(c => couponStatus(c) === 'active');
  const saved = state.coupons.filter(c => c.usedAt && monthOf(c.usedAt) === m).reduce((a, c) => a + (c.saved || 0), 0);
  const missed = state.coupons.filter(c => couponStatus(c) === 'expired' && monthOf(c.expires) === m).reduce((a, c) => a + (c.value || 0), 0);
  return { active: active.length, saved, missed };
}

/* ---------- 렌더 ---------- */
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#title').textContent = { home: '홈', coupons: '쿠폰', loyalty: '적립' }[ui.tab];
  $('#fab').hidden = ui.tab === 'home';
  $('#view').innerHTML = { home: renderHome, coupons: renderCoupons, loyalty: renderLoyalty }[ui.tab]();
  renderBrands();
}

function renderBrands() {
  const used = [...state.coupons, ...state.loyalty].map(x => x.brand);
  const all = [...new Set([...used, ...DEFAULT_BRANDS])];
  $('#brands').innerHTML = all.map(b => `<option value="${esc(b)}">`).join('');
}

function couponItem(c) {
  const st = couponStatus(c);
  const d = daysLeft(c);
  const badge = st === 'used' ? '<span class="badge mute">사용 완료</span>'
    : st === 'expired' ? '<span class="badge bad">만료</span>'
    : `<span class="badge ${ddayClass(d)}">${ddayLabel(d)}</span>`;
  const meta = [c.expires ? `~${c.expires}` : '', c.value ? won(c.value) : '', c.image ? '🖼' : ''].filter(Boolean).join(' · ');
  return `<div class="item" data-action="detail" data-id="${esc(c.id)}">
    <div class="l1"><div><div class="brand">${esc(c.brand)}</div><div class="name">${esc(c.title)}</div></div>${badge}</div>
    ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
  </div>`;
}

function loyaltyItem(l, full) {
  const p = pace(l);
  const pct = Math.min(100, Math.round((l.current / l.target) * 100));
  return `<div class="item" data-action="edit-loyalty" data-id="${esc(l.id)}">
    <div class="l1"><div><div class="brand">${esc(l.brand)}</div><div class="name">${esc(l.name)}</div></div>
      <b>${l.current} / ${l.target}</b></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="meta ${p.cls}">${esc(p.text)}${l.reward ? ` · 🎁 ${esc(l.reward)}` : ''}</div>
    ${full ? `<div class="step">
      <button data-action="dec" data-id="${esc(l.id)}">− 1</button>
      <button data-action="inc" data-id="${esc(l.id)}">+ 1</button></div>` : ''}
  </div>`;
}

function renderHome() {
  if (!state.coupons.length && !state.loyalty.length) {
    return `<div class="empty">아직 등록된 항목이 없음<br>
      <button class="primary" data-action="add-coupon">쿠폰 추가</button>
      <button class="ghost" data-action="sample">샘플 데이터 넣기</button></div>`;
  }
  const s = stats();
  const soon = state.coupons.filter(c => couponStatus(c) === 'active' && daysLeft(c) !== null && daysLeft(c) <= 7)
    .sort((a, b) => a.expires.localeCompare(b.expires));
  const goals = state.loyalty.filter(l => l.current < l.target)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  return `
    <div class="cards">
      <div class="stat"><b>${s.active}</b><span>사용 가능 쿠폰</span></div>
      <div class="stat"><b class="ok">${won(s.saved)}</b><span>이번 달 절약</span></div>
      <div class="stat"><b class="${s.missed ? 'bad' : ''}">${won(s.missed)}</b><span>이번 달 놓침</span></div>
    </div>
    <h2>곧 만료 (7일 이내)</h2>
    ${soon.length ? soon.map(couponItem).join('') : '<div class="empty">임박한 쿠폰 없음</div>'}
    <h2>적립 진행</h2>
    ${goals.length ? goals.map(l => loyaltyItem(l, false)).join('') : '<div class="empty">진행 중인 적립 없음</div>'}`;
}

function renderCoupons() {
  const brands = [...new Set(state.coupons.map(c => c.brand))];
  let list = state.coupons.filter(c => couponStatus(c) === ui.status && (!ui.brand || c.brand === ui.brand));
  list.sort((a, b) => ui.status === 'active'
    ? (a.expires || '9999').localeCompare(b.expires || '9999')
    : (b.usedAt || b.expires || '').localeCompare(a.usedAt || a.expires || ''));
  const chip = (v, label, on, attr) => `<button class="${on ? 'on' : ''}" data-action="${attr}" data-v="${esc(v)}">${esc(label)}</button>`;
  return `
    <div class="filters">
      ${chip('active', '사용 가능', ui.status === 'active', 'f-status')}
      ${chip('used', '사용 완료', ui.status === 'used', 'f-status')}
      ${chip('expired', '만료', ui.status === 'expired', 'f-status')}
    </div>
    ${brands.length ? `<div class="filters">${chip('', '전체', !ui.brand, 'f-brand')}${brands.map(b => chip(b, b, ui.brand === b, 'f-brand')).join('')}</div>` : ''}
    ${list.length ? list.map(couponItem).join('') : '<div class="empty">해당하는 쿠폰 없음</div>'}`;
}

function renderLoyalty() {
  const list = [...state.loyalty].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  return list.length ? list.map(l => loyaltyItem(l, true)).join('') : '<div class="empty">등록된 적립 항목 없음<br>＋ 버튼으로 추가</div>';
}

/* ---------- 이미지 ---------- */
function compressImage(file, max = 900, q = 0.72) {
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

/* ---------- 다이얼로그 ---------- */
let pendingImage = null; // undefined: 변경 없음, null: 제거, string: 새 이미지
function openCoupon(c) {
  const f = $('#form-coupon');
  f.reset();
  pendingImage = undefined;
  $('#coupon-form-title').textContent = c ? '쿠폰 수정' : '쿠폰 추가';
  f.id.value = c?.id || '';
  f.brand.value = c?.brand || ui.brand || '';
  f.title.value = c?.title || '';
  f.value.value = c?.value ?? '';
  f.expires.value = c?.expires || '';
  f.code.value = c?.code || '';
  f.memo.value = c?.memo || '';
  $('#img-preview').innerHTML = c?.image ? `<img src="${esc(c.image)}" alt="">` : '';
  $('#dlg-coupon').showModal();
}
function openLoyalty(l) {
  const f = $('#form-loyalty');
  f.reset();
  $('#loyalty-form-title').textContent = l ? '적립 수정' : '적립 추가';
  f.id.value = l?.id || '';
  f.brand.value = l?.brand || '';
  f.name.value = l?.name || '';
  f.current.value = l?.current ?? 0;
  f.target.value = l?.target ?? '';
  f.deadline.value = l?.deadline || '';
  f.reward.value = l?.reward || '';
  f.memo.value = l?.memo || '';
  $('#dlg-loyalty').showModal();
}

function openDetail(id) {
  const c = state.coupons.find(x => x.id === id);
  if (!c) return;
  const st = couponStatus(c);
  const d = daysLeft(c);
  $('#detail').innerHTML = `
    <div class="brand">${esc(c.brand)}</div>
    <h3>${esc(c.title)}</h3>
    <div class="meta">${st === 'used' ? `사용 완료 ${esc(c.usedAt)} · 절약 ${won(c.saved)}`
      : st === 'expired' ? `만료됨 (${esc(c.expires)})`
      : `${ddayLabel(d)}${c.expires ? ` · ~${esc(c.expires)}` : ''}${c.value ? ` · ${won(c.value)}` : ''}`}</div>
    ${c.image ? `<div class="code-img"><img src="${esc(c.image)}" alt="바코드"></div>` : ''}
    ${c.code ? `<div class="code-text">${esc(c.code)}</div>` : ''}
    ${c.memo ? `<p class="hint">${esc(c.memo)}</p>` : ''}
    <div class="row">
      <button class="ghost danger" data-action="del-coupon" data-id="${esc(c.id)}">삭제</button>
      <button class="ghost" data-action="edit-coupon" data-id="${esc(c.id)}">수정</button>
      ${st === 'used'
        ? `<button class="primary" data-action="unuse" data-id="${esc(c.id)}">사용 취소</button>`
        : `<button class="primary" data-action="use" data-id="${esc(c.id)}">사용 완료</button>`}
    </div>
    <div class="row"><button class="ghost" data-action="close-dialog">닫기</button></div>`;
  $('#dlg-detail').showModal();
}

/* ---------- 알림 ---------- */
function notifyState() {
  const el = $('#notify-state');
  if (!('Notification' in window)) { el.textContent = '이 브라우저는 알림 미지원'; return; }
  el.textContent = { granted: '알림 허용됨', denied: '알림 차단됨 (브라우저 설정에서 변경 필요)', default: '알림 미설정' }[Notification.permission];
}
async function maybeNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (state.lastNotify === today()) return;
  const soon = state.coupons.filter(c => couponStatus(c) === 'active' && daysLeft(c) !== null && daysLeft(c) <= 3);
  const goals = state.loyalty.filter(l => l.current < l.target && l.deadline && dayDiff(today(), l.deadline) >= 0 && dayDiff(today(), l.deadline) <= 7);
  if (!soon.length && !goals.length) return;
  const lines = [
    ...soon.map(c => `${c.brand} ${c.title} (${ddayLabel(daysLeft(c))})`),
    ...goals.map(l => `${l.brand} ${l.name} 마감 D-${dayDiff(today(), l.deadline)}`)
  ];
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('쿠폰 지갑', { body: lines.slice(0, 5).join('\n'), icon: 'icon-192.png', tag: 'daily' });
    state.lastNotify = today(); save();
  } catch (e) { /* 알림 실패는 무시 */ }
}

/* ---------- 백업 ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `coupon-wallet-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!Array.isArray(s.coupons) || !Array.isArray(s.loyalty)) throw new Error();
      if (!confirm('현재 데이터를 백업 내용으로 덮어씀. 진행?')) return;
      state = { coupons: s.coupons, loyalty: s.loyalty, lastNotify: '' };
      save(); render(); toast('불러오기 완료');
    } catch (e) { toast('올바른 백업 파일이 아님'); }
  };
  r.readAsText(file);
}
function addSamples() {
  const t = new Date();
  const off = n => { const d = new Date(t); d.setDate(d.getDate() + n); return toStr(d); };
  state.coupons.push(
    { id: uid(), brand: '스타벅스', title: '아메리카노 T 1잔', value: 4700, expires: off(2), code: '1234 5678 9012', memo: '샘플' },
    { id: uid(), brand: '올리브영', title: '10% 할인 (최대 5천원)', value: 5000, expires: off(12), code: '', memo: '샘플' },
    { id: uid(), brand: 'CU', title: '모바일 상품권 3천원', value: 3000, expires: off(-3), code: '', memo: '샘플' }
  );
  state.loyalty.push(
    { id: uid(), brand: '스타벅스', name: '프리퀀시 (샘플)', current: 6, target: 17, deadline: off(60), reward: '증정품', memo: '' },
    { id: uid(), brand: '스타벅스', name: '등급 유지 별 (샘플)', current: 267, target: 300, deadline: '', reward: 'Gold 유지', memo: '' }
  );
  save(); render(); toast('샘플 추가됨');
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action: a, id, v } = el.dataset;
  const closeAll = () => document.querySelectorAll('dialog[open]').forEach(d => d.close());

  switch (a) {
    case 'add': ui.tab === 'loyalty' ? openLoyalty() : openCoupon(); break;
    case 'add-coupon': openCoupon(); break;
    case 'close-dialog': el.closest('dialog').close(); break;
    case 'open-settings': notifyState(); $('#dlg-settings').showModal(); break;
    case 'detail': openDetail(id); break;
    case 'edit-coupon': closeAll(); openCoupon(state.coupons.find(c => c.id === id)); break;
    case 'edit-loyalty': openLoyalty(state.loyalty.find(l => l.id === id)); break;
    case 'f-status': ui.status = v; render(); break;
    case 'f-brand': ui.brand = v; render(); break;
    case 'use': {
      const c = state.coupons.find(x => x.id === id);
      const input = prompt('실제 절약한 금액(원)', c.value || 0);
      if (input === null) break;
      c.usedAt = today(); c.saved = Math.max(0, Number(input) || 0);
      save(); closeAll(); render(); toast('사용 완료 처리');
      break;
    }
    case 'unuse': {
      const c = state.coupons.find(x => x.id === id);
      delete c.usedAt; delete c.saved;
      save(); closeAll(); render();
      break;
    }
    case 'del-coupon':
      if (confirm('이 쿠폰을 삭제?')) { state.coupons = state.coupons.filter(c => c.id !== id); save(); closeAll(); render(); }
      break;
    case 'inc': case 'dec': {
      e.stopPropagation();
      const l = state.loyalty.find(x => x.id === id);
      l.current = Math.max(0, l.current + (a === 'inc' ? 1 : -1));
      save(); render();
      break;
    }
    case 'enable-notify':
      if (!('Notification' in window)) { toast('알림 미지원 브라우저'); break; }
      await Notification.requestPermission(); notifyState(); maybeNotify();
      break;
    case 'export': exportData(); break;
    case 'sample': closeAll(); addSamples(); break;
    case 'wipe':
      if (confirm('모든 데이터를 삭제. 되돌릴 수 없음. 진행?')) { state = { coupons: [], loyalty: [], lastNotify: '' }; save(); closeAll(); render(); }
      break;
  }
});

$('#form-coupon').image.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingImage = await compressImage(file);
    $('#img-preview').innerHTML = `<img src="${pendingImage}" alt="">`;
  } catch (err) { toast('이미지를 읽지 못함'); }
});

$('#form-coupon').addEventListener('submit', () => {
  const f = $('#form-coupon');
  const data = {
    brand: f.brand.value.trim(), title: f.title.value.trim(),
    value: f.value.value === '' ? 0 : Math.max(0, Number(f.value.value)),
    expires: f.expires.value, code: f.code.value.trim(), memo: f.memo.value.trim()
  };
  const existing = state.coupons.find(c => c.id === f.id.value);
  if (existing) {
    Object.assign(existing, data);
    if (pendingImage !== undefined) existing.image = pendingImage;
  } else {
    state.coupons.push({ id: uid(), ...data, ...(pendingImage ? { image: pendingImage } : {}) });
  }
  if (save()) { ui.tab = 'coupons'; ui.status = 'active'; ui.brand = ''; toast('저장됨'); }
  render();
});

$('#form-loyalty').addEventListener('submit', () => {
  const f = $('#form-loyalty');
  const data = {
    brand: f.brand.value.trim(), name: f.name.value.trim(),
    current: Math.max(0, Number(f.current.value) || 0), target: Math.max(1, Number(f.target.value) || 1),
    deadline: f.deadline.value, reward: f.reward.value.trim(), memo: f.memo.value.trim()
  };
  const existing = state.loyalty.find(l => l.id === f.id.value);
  if (existing) Object.assign(existing, data); else state.loyalty.push({ id: uid(), ...data });
  if (save()) toast('저장됨');
  render();
});

$('#import-file').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

/* ---------- 시작 ---------- */
render();
maybeNotify();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
