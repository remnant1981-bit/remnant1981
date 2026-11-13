/* 메종도로시 화면 — 설정(config.js)과 로직(logic.js)을 읽어 그림 */
(function () {
  'use strict';
  const C = window.DOROTHY, L = window.DLogic, S = C.store;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CART_KEY = 'dorothy-cart';

  /* ---------- 매장 정보 ---------- */
  $('previewBar').hidden = !C.preview;
  $('sizes').innerHTML = S.sizes.map(s => `<span>${esc(s)}</span>`).join('');
  $('storeName').textContent = S.name;
  $('tagline').textContent = S.tagline;
  $('addr').textContent = S.address;
  $('hours').textContent = S.hours;
  $('biz').textContent = S.business;
  $('shipInfo').textContent = `${L.won(C.shipping.fee)} · ${L.won(C.shipping.freeOver)} 이상 무료 · 입금 다음 날 발송`;
  function link(id, href, show = !!href) { const a = $(id); if (show) a.href = href; else a.hidden = true; }
  link('qKakao', S.kakaoUrl);
  link('qInsta', S.instagram);
  link('qMap', S.mapUrl);
  link('qBand', S.bandUrl);
  link('qPhone', 'tel:' + S.phone.replace(/[^0-9]/g, ''), !!S.phone);
  $('qPhoneNo').textContent = S.phone;

  /* ---------- 상품 목록 ---------- */
  const tone = p => `linear-gradient(135deg,${p.tone[0]} 0 50%,${p.tone[1]} 50% 100%)`;
  const ph = p => p.img
    ? `<img src="images/${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">`
    : '';
  let cat = 'all';
  $('filters').innerHTML = ['all', ...C.categories]
    .map(c => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === 'all'}">${c === 'all' ? '전체' : esc(c)}</button>`).join('');
  $('filters').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.cat;
    $('filters').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });
  function render() {
    const list = C.products.filter(p => cat === 'all' || p.cat === cat);
    $('count').textContent = `${list.length}개`;
    $('grid').innerHTML = list.map(p => `
      <button type="button" class="card" data-id="${esc(p.id)}"${p.soldOut ? ' disabled' : ''}>
        <div class="ph" style="background:${tone(p)}">${ph(p)}${p.soldOut ? '<span class="badge out">품절</span>' : p.isNew ? '<span class="badge">NEW</span>' : ''}</div>
        <b>${esc(p.name)}</b><span class="price">${L.won(p.price)}</span><span class="fit">${p.sizes.map(esc).join(' · ')}</span>
      </button>`).join('');
  }
  $('grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c && !c.disabled) openProduct(c.dataset.id); });

  /* ---------- 장바구니 ---------- */
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch (e) { cart = []; }
  cart = cart.filter(x => C.products.some(p => p.id === x.id && !p.soldOut));
  const save = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* 저장 불가 환경 */ } };
  const pickup = () => $('shipPick').checked;
  function bar() {
    const t = L.totals(cart, C.shipping, false);
    $('barCount').textContent = `담은 상품 ${t.count}개`;
    $('barTotal').textContent = L.won(t.sub);
    $('openCart').disabled = t.count === 0;
  }

  /* ---------- 상품 상세 ---------- */
  let cur = null, selC = null, selS = null;
  function chips(el, arr, onPick, preset) {
    el.innerHTML = arr.map(v => `<button type="button" aria-pressed="${v === preset}">${esc(v)}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onPick(b.textContent); $('pErr').hidden = true;
    }));
  }
  function openProduct(id) {
    cur = C.products.find(p => p.id === id);
    selC = cur.colors.length === 1 ? cur.colors[0] : null;
    selS = cur.sizes.length === 1 ? cur.sizes[0] : null;
    $('pName').textContent = cur.name;
    $('pPh').style.background = tone(cur);
    $('pPh').innerHTML = ph(cur);
    $('pPrice').textContent = L.won(cur.price);
    $('pDesc').textContent = cur.desc;
    $('pOwner').innerHTML = `<b>88사장 실착</b> · ${esc(cur.owner)}`;
    $('pMeasure').textContent = `실측: ${cur.measure}`;
    chips($('pColors'), cur.colors, v => { selC = v; }, selC);
    chips($('pSizes'), cur.sizes, v => { selS = v; }, selS);
    $('pErr').hidden = true;
    show('pSheet');
  }
  $('addBtn').addEventListener('click', () => {
    if (!selC || !selS) { $('pErr').hidden = false; return; }
    cart = L.addLine(cart, cur, selC, selS); save(); bar(); hide('pSheet');
  });

  /* ---------- 주문서 ---------- */
  function drawCart() {
    $('lines').innerHTML = cart.map((x, i) => `
      <div class="line"><div>${esc(x.name)} ×${x.q}<small>${esc(x.color)} / ${esc(x.size)}</small></div>
      <div class="rt"><span>${L.won(x.price * x.q)}</span><button type="button" class="rm" data-i="${i}">빼기</button></div></div>`).join('');
    const t = L.totals(cart, C.shipping, pickup());
    $('tot').innerHTML = `<div><span>상품</span><span>${L.won(t.sub)}</span></div>
      <div><span>택배비</span><span>${t.ship ? L.won(t.ship) : '무료'}</span></div>
      <div class="all"><span>입금하실 금액</span><span>${L.won(t.all)}</span></div>`;
    $('addrBox').hidden = pickup();
  }
  $('lines').addEventListener('click', e => {
    const b = e.target.closest('.rm'); if (!b) return;
    cart = L.removeOne(cart, +b.dataset.i); save(); bar();
    if (!cart.length) { hide('cSheet'); return; }
    drawCart();
  });
  document.querySelectorAll('input[name="ship"]').forEach(r => r.addEventListener('change', drawCart));
  $('orderForm').addEventListener('input', () => { $('oErr').hidden = true; });
  $('openCart').addEventListener('click', () => { drawCart(); show('cSheet'); });

  $('orderForm').addEventListener('submit', async e => {
    e.preventDefault();
    const o = { name: $('oName').value, phone: $('oPhone').value, pickup: pickup(), address: $('oAddr').value, memo: $('oMemo').value, agree: $('oAgree').checked };
    const miss = L.validate(o);
    if (miss.length) { $('oErr').textContent = `확인해 주세요: ${miss.join(', ')}`; $('oErr').hidden = false; return; }
    $('oErr').hidden = true;
    const t = L.totals(cart, C.shipping, o.pickup);
    const no = L.orderNo();
    const text = L.orderText(no, cart, t, o);
    let note = '';
    if (C.preview) {
      note = '오픈 준비 중이라 실제 주문은 접수되지 않았어요.';
    } else if (C.orderEndpoint && !$('oWeb').value) {
      $('submitBtn').disabled = true; $('submitBtn').textContent = '접수 중…';
      const sent = await send({ no, items: cart, ...t, ...o, text });
      $('submitBtn').disabled = false; $('submitBtn').textContent = '주문 접수하기';
      if (!sent) note = '접수 연결이 원활하지 않아요. 아래 주문 내용을 복사해 카톡으로 보내주세요.';
    } else {
      note = '아래 주문 내용을 복사해 카톡으로 보내주시면 접수가 완료돼요.';
    }
    $('dNote').textContent = note; $('dNote').hidden = !note;
    $('dTitle').textContent = C.preview ? '주문 미리보기' : note ? '주문 내용을 보내주세요' : '주문이 접수됐어요';
    $('dBank').textContent = S.bank;
    $('dText').textContent = text;
    $('dKakao').textContent = `카톡채널 '${S.kakaoId}'로 문의하시면 더 빨리 확인해 드려요.`;
    if (!C.preview) { cart = []; save(); bar(); }
    hide('cSheet'); show('dSheet');
  });

  // Apps Script 웹앱은 CORS 응답을 주지 않으므로 no-cors 로 보냄 (전송 실패만 감지 가능)
  async function send(payload) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      await fetch(C.orderEndpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), signal: ctl.signal });
      return true;
    } catch (err) { return false; } finally { clearTimeout(timer); }
  }

  $('copyOrder').addEventListener('click', function () {
    const b = this, pre = $('dText');
    const ok = () => { b.textContent = '복사됐어요'; setTimeout(() => { b.textContent = '주문 내용 복사'; }, 1600); };
    const fb = () => { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = '길게 눌러 복사해 주세요'; };
    try { navigator.clipboard.writeText(pre.innerText).then(ok, fb); } catch (err) { fb(); }
  });

  /* ---------- 시트 열고 닫기 ---------- */
  let lastFocus = null;
  function show(id) { lastFocus = document.activeElement; $(id).hidden = false; document.body.style.overflow = 'hidden'; const f = $(id).querySelector('button,input'); if (f) f.focus(); }
  function hide(id) {
    $(id).hidden = true;
    if (!document.querySelector('.sheet:not([hidden])')) { document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  }
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => {
    if (e.target === s || e.target.hasAttribute('data-close')) hide(s.id);
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet:not([hidden])').forEach(s => hide(s.id)); });

  render(); bar();
})();
