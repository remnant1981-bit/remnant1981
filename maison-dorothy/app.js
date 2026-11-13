/* 메종도로시 화면 — 설정(config.js)과 로직(logic.js)을 읽어 그림 */
(function () {
  'use strict';
  const C = window.DOROTHY, L = window.DLogic, S = C.store;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CART_KEY = 'dorothy-cart';
  const byId = id => C.products.find(p => p.id === id);
  const askUrl = S.kakaoUrl || S.dmUrl || S.instagram;   // 문의 창구: 카톡채널 > 인스타 DM
  const askName = S.kakaoUrl ? '카톡' : 'DM';

  /* ---------- 매장 정보 ---------- */
  $('previewBar').hidden = !C.preview;
  $('sizes').innerHTML = S.sizes.map(s => `<span>${esc(s)}</span>`).join('');
  $('storeName').textContent = S.name;
  $('tagline').textContent = S.tagline;
  $('intro').textContent = S.intro;
  $('addr').textContent = S.address;
  $('landmark').textContent = S.landmark;
  $('hours').textContent = S.hours;
  $('biz').textContent = S.business;
  $('shipInfo').textContent = `${L.won(C.shipping.fee)} · ${L.won(C.shipping.freeOver)} 이상 무료 · 입금 다음 날 발송`;
  function link(id, href) { const a = $(id); if (href) a.href = href; else a.hidden = true; }
  link('ctaAsk', askUrl);
  link('moreInsta', S.instagram);
  link('qMap', S.mapUrl);
  link('qBand', S.bandUrl);
  link('qPhone', S.phone ? 'tel:' + S.phone.replace(/[^0-9]/g, '') : '');
  link('dAsk', askUrl);
  $('dAsk').textContent = `${askName}으로 보내기`;

  const st = C.story;
  if (st) {
    $('storyImg').src = 'images/' + st.photo; $('storyImg').alt = st.photoAlt;
    $('storyTitle').textContent = st.quote; $('storyBy').textContent = st.by; $('storyText').textContent = st.text;
  } else document.querySelector('.story').hidden = true;

  /* ---------- 상품 목록 ---------- */
  const img = (file, alt, lazy = true) => `<img src="images/${esc(file)}" alt="${esc(alt)}" width="720" height="900"${lazy ? ' loading="lazy"' : ''}>`;
  const badge = p => p.soldOut ? '<span class="badge out">품절</span>'
    : p.badge ? `<span class="badge${p.badge === 'NEW' ? '' : ' rec'}">${esc(p.badge)}</span>` : '';
  const card = (p, i = 9) => `
    <button type="button" class="card" data-id="${esc(p.id)}"${p.soldOut ? ' disabled' : ''}>
      <div class="ph">${img(p.img, p.name, i > 3)}${badge(p)}</div>
      <b>${esc(p.name)}</b>
      <span class="price${L.hasPrice(p) ? '' : ' ask'}">${L.priceLabel(p)}</span>
      <span class="fit">${esc(L.fitLabel(p))}</span>
    </button>`;

  let cat = 'all', mySize = 0;
  try { mySize = Number(localStorage.getItem('dorothy-size')) || 0; } catch (e) { /* 없음 */ }
  $('filters').innerHTML = ['all', ...C.categories]
    .map(c => `<button type="button" data-v="${esc(c)}" aria-pressed="${c === 'all'}">${c === 'all' ? '전체' : esc(c)}</button>`).join('');
  $('mySize').innerHTML = [0, 66, 77, 88, 99]
    .map(s => `<button type="button" data-v="${s}" aria-pressed="${s === mySize}">${s ? s : '전체'}</button>`).join('');
  function pressGroup(el, onPick) {
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onPick(b.dataset.v); render();
    });
  }
  pressGroup($('filters'), v => { cat = v; });
  pressGroup($('mySize'), v => { mySize = Number(v); try { localStorage.setItem('dorothy-size', v); } catch (e) { /* 저장 불가 */ } });

  function render() {
    const list = C.products.filter(p => (cat === 'all' || p.cat === cat) && L.fitsSize(p, mySize));
    $('count').textContent = `${list.length}벌`;
    $('grid').innerHTML = list.length ? list.map(card).join('')
      : `<p class="empty">조건에 맞는 옷이 아직 없어요. <a href="${esc(askUrl)}" target="_blank" rel="noopener">${askName}으로 물어보세요</a></p>`;
  }
  document.addEventListener('click', e => {
    const c = e.target.closest('.card'); if (c && !c.disabled) openProduct(c.dataset.id);
  });

  /* ---------- 장바구니 ---------- */
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch (e) { cart = []; }
  cart = cart.filter(x => { const p = byId(x.id); return p && !p.soldOut; })
    .map(x => ({ ...x, price: L.hasPrice(byId(x.id)) ? byId(x.id).price : null }));
  const save = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* 저장 불가 */ } };
  const pickup = () => $('shipPick').checked;
  function bar() {
    const t = L.totals(cart, C.shipping, false);
    $('barCount').textContent = `담은 옷 ${t.count}벌`;
    $('barTotal').textContent = !t.count ? '' : t.unpriced ? (t.sub ? `${L.won(t.sub)} + 가격 문의` : '가격은 확인 후 안내') : L.won(t.sub);
    $('openCart').disabled = t.count === 0;
  }
  let toastTimer = 0;
  function toast(msg) { $('toast').textContent = msg; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1800); }

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
    if (!$('pSheet').hidden) hide('pSheet');
    cur = byId(id);
    const colors = cur.colors || [];
    const so = L.sizeOptions(cur);
    selC = colors.length === 1 ? colors[0] : null;
    const usual = mySize ? `평소 ${mySize}` : null;
    selS = so.values.length === 1 ? so.values[0] : (usual && so.values.includes(usual) ? usual : null);
    $('pBadge').textContent = cur.badge || '';
    $('pGallery').innerHTML = [cur.img, ...(cur.gallery || [])].map((f, i) => img(f, `${cur.name} 사진 ${i + 1}`, false)).join('');
    $('pGallery').scrollLeft = 0;
    $('pName').textContent = cur.name;
    $('pPrice').textContent = L.priceLabel(cur);
    $('pDesc').textContent = cur.desc;
    $('pTip').textContent = cur.tip;
    $('pFit').textContent = Array.isArray(cur.fit) ? `${cur.fit[0]}~${cur.fit[1]} 사이즈 추천 · 정확한 핏은 사장님이 확인해 드려요`
      : cur.sizes ? '사이즈가 고민되면 메모에 평소 사이즈를 적어주세요' : '사이즈는 평소 입는 사이즈를 알려주시면 맞춰드려요';
    $('pColorBox').hidden = !colors.length;
    chips($('pColors'), colors, v => { selC = v; }, selC);
    $('pSizeLab').textContent = so.label;
    chips($('pSizes'), so.values, v => { selS = v; }, selS);
    link('pPost', cur.post); $('pPost').hidden = !cur.post;
    link('pAsk', askUrl);
    const pairs = (cur.pair || []).map(byId).filter(p => p && !p.soldOut);
    $('pPairBox').hidden = !pairs.length;
    $('pPair').innerHTML = pairs.map(p => card(p)).join('');
    $('pErr').hidden = true;
    $('addBtn').textContent = L.hasPrice(cur) ? '담기' : '담기 (가격은 확인 후 안내)';
    show('pSheet');
    $('pSheet').querySelector('.panel').scrollTop = 0;
  }
  $('addBtn').addEventListener('click', () => {
    const needC = (cur.colors || []).length > 0;
    if ((needC && !selC) || !selS) {
      $('pErr').textContent = needC && !selC ? '컬러를 골라주세요.' : '사이즈를 골라주세요.';
      $('pErr').hidden = false; return;
    }
    cart = L.addLine(cart, cur, needC ? selC : '', selS); save(); bar(); hide('pSheet');
    toast(`${cur.name} 담았어요`);
  });

  /* ---------- 주문서 ---------- */
  function drawCart() {
    $('lines').innerHTML = cart.map((x, i) => {
      const p = byId(x.id);
      return `<div class="line"><img src="images/${esc(p.img)}" alt="" width="44" height="55">
        <div class="nm">${esc(x.name)} ×${x.q}<small>${esc([x.color, x.size].filter(Boolean).join(' / '))}</small></div>
        <div class="rt"><span>${x.price > 0 ? L.won(x.price * x.q) : '문의'}</span><button type="button" class="rm" data-i="${i}">빼기</button></div></div>`;
    }).join('');
    const t = L.totals(cart, C.shipping, pickup());
    $('tot').innerHTML = t.unpriced
      ? `<div><span>택배비</span><span>${t.ship === 0 ? '무료 (픽업)' : '확인 후 안내'}</span></div>
         <div class="all"><span>입금하실 금액</span><span>사장님이 확인 후 안내</span></div>`
      : `<div><span>상품</span><span>${L.won(t.sub)}</span></div>
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
    let note = '', sent = false;
    if (C.preview) {
      note = '오픈 준비 중이라 실제 주문은 접수되지 않았어요.';
    } else if (C.orderEndpoint && !$('oWeb').value) {
      $('submitBtn').disabled = true; $('submitBtn').textContent = '보내는 중…';
      sent = await send({ no, items: cart, ...t, ...o, text });
      $('submitBtn').disabled = false; $('submitBtn').textContent = '주문서 보내기';
      if (!sent) note = `연결이 원활하지 않아요. 아래 주문 내용을 복사해 ${askName}으로 보내주세요.`;
    } else {
      note = `아래 주문 내용을 복사해 ${askName}으로 보내주시면 접수돼요.`;
    }
    $('dNote').textContent = note; $('dNote').hidden = !note;
    $('dTitle').textContent = C.preview ? '주문서 미리보기' : sent ? '주문서를 받았어요' : '주문 내용을 보내주세요';
    $('dSteps').innerHTML = (t.all === null
      ? ['사장님이 사이즈·재고·가격을 확인해 연락드려요', '안내받은 금액을 입금해 주세요', '입금 다음 날 발송 (픽업은 준비되면 연락)']
      : [`입금하실 금액 <b>${L.won(t.all)}</b>`, `입금 계좌 <b>${esc(S.bank)}</b>`, '사장님이 사이즈 확인 후 연락드리고, 입금 다음 날 발송해요']
    ).map(s => `<li>${s}</li>`).join('');
    $('dText').textContent = text;
    if (!C.preview && sent) { cart = []; save(); bar(); }
    hide('cSheet'); show('dSheet');
  });

  // Apps Script 웹앱은 CORS 응답을 주지 않으므로 no-cors 로 보냄 (네트워크 실패만 감지 가능)
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
  function show(id) { if (document.querySelector('.sheet:not([hidden])') === null) lastFocus = document.activeElement; $(id).hidden = false; document.body.style.overflow = 'hidden'; const f = $(id).querySelector('.x'); if (f) f.focus({ preventScroll: true }); }
  function hide(id) {
    $(id).hidden = true;
    if (!document.querySelector('.sheet:not([hidden])')) { document.body.style.overflow = ''; if (lastFocus) lastFocus.focus({ preventScroll: true }); }
  }
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => {
    if (e.target === s || e.target.hasAttribute('data-close')) hide(s.id);
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet:not([hidden])').forEach(s => hide(s.id)); });

  render(); bar();
})();
