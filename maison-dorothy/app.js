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
  const src = f => (window.__IMG && window.__IMG[f]) || `images/${f}`;   // 미리보기 번들에서는 내장 이미지 사용
  const arrow = '<svg><use href="#i-arrow"/></svg>';

  /* ---------- 매장 정보 ---------- */
  $('previewBar').hidden = !C.preview;
  $('storeName').textContent = S.name;
  $('tagline').textContent = S.tagline + '. ' + S.intro;
  $('footTag').textContent = S.tagline;
  $('addr').textContent = S.address;
  $('landmark').textContent = S.landmark;
  $('hours').textContent = S.hours;
  $('biz').textContent = S.business;
  $('shipInfo').textContent = `${L.won(C.shipping.fee)}, ${L.won(C.shipping.freeOver)} 이상 무료예요. 매장 픽업은 택배비가 없어요. 입금 다음 날 발송합니다.`;
  $('shipSmall').textContent = `${L.won(C.shipping.fee)} · ${C.shipping.freeOver / 10000}만원 이상 무료`;
  function link(id, href) { const a = $(id); a.hidden = !href; if (href) a.href = href; }
  link('ctaAsk', askUrl);
  link('qMap', S.mapUrl);
  link('qInsta', S.instagram);
  link('qBand', S.bandUrl);
  link('qPhone', S.phone ? 'tel:' + S.phone.replace(/[^0-9]/g, '') : '');
  link('dAsk', askUrl);
  $('dAsk').textContent = `${askName}으로 보내기`;

  const st = C.story;
  if (st) {
    $('storyImg').src = src(st.photo); $('storyImg').alt = st.photoAlt;
    $('storyTitle').textContent = st.quote; $('storyBy').textContent = '— ' + st.by; $('storyText').textContent = st.text;
  } else document.querySelector('.story').hidden = true;

  const topbar = $('topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- 상품 카드 ---------- */
  const img = (file, alt, lazy = true, cls = '') => `<img${cls ? ` class="${cls}"` : ''} src="${src(file)}" alt="${esc(alt)}" width="720" height="900"${lazy ? ' loading="lazy" decoding="async"' : ''}>`;
  const tag = p => p.soldOut ? '<span class="tag out">Sold out</span>'
    : p.badge === 'NEW' ? '<span class="tag">New</span>'
    : p.badge ? `<span class="tag rec">${esc(p.badge)}</span>` : '';
  const card = (p, i = 9) => `
    <button type="button" class="card" data-open="${esc(p.id)}"${p.soldOut ? ' disabled' : ''}>
      <div class="ph">${img(p.img, p.name, i > 3)}${p.gallery && p.gallery[0] ? img(p.gallery[0], '', true, 'alt') : ''}${tag(p)}<span class="quick">자세히 보기</span></div>
      <span class="nm">${esc(p.name)}</span>
      <span class="pr${L.hasPrice(p) ? '' : ' ask'}">${L.priceLabel(p)}</span>
      <span class="fit">${esc(L.fitLabel(p))}</span>
    </button>`;

  /* ---------- 사장님 픽 ---------- */
  const pick = byId(C.pick);
  if (pick) {
    $('pick').innerHTML = `
      <button type="button" class="ph" data-open="${esc(pick.id)}" style="border:0;padding:0;cursor:pointer">${img(pick.img, pick.name, false)}${tag(pick)}</button>
      <div class="pick-txt">
        <p class="eyebrow">Owner's Pick</p>
        <h2 id="pickTitle">${esc(pick.name)}</h2>
        <p class="q">“${esc(pick.tip)}”</p>
        <p class="meta"><span>${esc(L.fitLabel(pick))}</span><span>${L.priceLabel(pick)}</span></p>
        <button type="button" class="btn dark" data-open="${esc(pick.id)}">자세히 보기${arrow}</button>
      </div>`;
  } else $('pick').hidden = true;

  /* ---------- 코디 ---------- */
  const looks = (C.looks || []).filter(l => l.items.some(id => byId(id)));
  $('looksList').innerHTML = looks.map((l, i) => `
    <button type="button" class="look" data-open="${esc(l.items[0])}">
      <div class="ph">${img(l.img, l.title)}<span class="num">${String(i + 1).padStart(2, '0')}</span></div>
      <h3>${esc(l.title)}</h3>
      <p>${esc(l.note)}</p>
      <span class="go">${l.items.map(id => esc(byId(id).name)).join(' + ')} 보기${arrow}</span>
    </button>`).join('');
  if (!looks.length) $('looks').hidden = true;

  /* ---------- 필터 ---------- */
  let cat = 'all', mySize = 0;
  try { mySize = Number(localStorage.getItem('dorothy-size')) || 0; } catch (e) { /* 없음 */ }
  $('filters').innerHTML = ['all', ...C.categories]
    .map(c => `<button type="button" data-v="${esc(c)}" aria-pressed="${c === 'all'}">${c === 'all' ? '전체' : esc(c)}</button>`).join('');
  $('mySize').innerHTML = [0, 66, 77, 88, 99]
    .map(s => `<button type="button" data-v="${s}" aria-pressed="${s === mySize}">${s || '전체'}</button>`).join('');
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
    $('count').textContent = `${list.length}개의 옷${mySize ? ` · ${mySize} 사이즈 추천` : ''}`;
    $('grid').innerHTML = list.length ? list.map(card).join('')
      : `<p class="empty">조건에 맞는 옷이 아직 없어요.<br><a href="${esc(askUrl)}" target="_blank" rel="noopener">${askName}으로 찾는 옷을 말씀해 주세요</a></p>`;
  }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o && !o.disabled) openProduct(o.dataset.open);
  });

  /* ---------- 쇼핑백 상태 ---------- */
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch (e) { cart = []; }
  cart = cart.filter(x => { const p = byId(x.id); return p && !p.soldOut; })
    .map(x => ({ ...x, price: L.hasPrice(byId(x.id)) ? byId(x.id).price : null }));
  const save = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* 저장 불가 */ } };
  const pickup = () => $('shipPick').checked;
  function bar(bump) {
    const t = L.totals(cart, C.shipping, false);
    $('bagCount').hidden = !t.count; $('bagCount').textContent = t.count;
    if (bump) { $('bagCount').classList.remove('bump'); void $('bagCount').offsetWidth; $('bagCount').classList.add('bump'); }
    $('bagbar').hidden = !t.count;
    $('barCount').textContent = `쇼핑백 ${t.count}벌`;
    $('barTotal').textContent = t.unpriced ? (t.sub ? `${L.won(t.sub)} + 가격 문의` : '가격은 확인 후 안내') : L.won(t.sub);
  }
  let toastTimer = 0;
  function toast(msg) { $('toast').textContent = msg; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2000); }

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
    cur = byId(id); if (!cur) return;
    if (!$('pSheet').hidden) hide('pSheet');
    const colors = cur.colors || [];
    const so = L.sizeOptions(cur);
    const usual = mySize ? `평소 ${mySize}` : null;
    selC = colors.length === 1 ? colors[0] : null;
    selS = so.values.length === 1 ? so.values[0] : (usual && so.values.includes(usual) ? usual : null);
    const pics = [cur.img, ...(cur.gallery || [])];
    $('pGallery').innerHTML = pics.map((f, i) => img(f, `${cur.name} 사진 ${i + 1}`, false)).join('');
    $('pGallery').scrollLeft = 0;
    $('pDots').innerHTML = pics.length > 1 ? pics.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('') : '';
    $('pCat').textContent = [cur.cat, cur.badge].filter(Boolean).join(' · ');
    $('pName').textContent = cur.name;
    $('pPrice').textContent = L.priceLabel(cur); $('pPrice').classList.toggle('ask', !L.hasPrice(cur));
    $('pDesc').textContent = cur.desc;
    $('pTip').textContent = cur.tip;
    $('pFit').textContent = Array.isArray(cur.fit) ? `${cur.fit[0]}~${cur.fit[1]} 사이즈 추천 · 정확한 핏은 사장님이 확인해 드려요`
      : cur.sizes ? '사이즈가 고민되면 주문서 메모에 평소 사이즈를 적어주세요' : '평소 입는 사이즈를 고르면 사장님이 맞춰드려요';
    $('pColorBox').hidden = !colors.length;
    chips($('pColors'), colors, v => { selC = v; $('pColorSel').textContent = v; }, selC);
    $('pColorSel').textContent = selC || '';
    $('pSizeLab').textContent = so.label;
    chips($('pSizes'), so.values, v => { selS = v; $('pSizeSel').textContent = v; }, selS);
    $('pSizeSel').textContent = selS || '';
    $('pPost').hidden = !cur.post; if (cur.post) $('pPost').href = cur.post;
    link('pAsk', askUrl);
    const pairs = (cur.pair || []).map(byId).filter(p => p && !p.soldOut);
    $('pPairBox').hidden = !pairs.length;
    $('pPair').innerHTML = pairs.map(p => card(p)).join('');
    $('pErr').hidden = true;
    $('addBtn').textContent = L.hasPrice(cur) ? '쇼핑백에 담기' : '쇼핑백에 담기 · 가격은 확인 후 안내';
    show('pSheet');
    $('pSheet').querySelector('.panel').scrollTop = 0;
  }
  $('pGallery').addEventListener('scroll', () => {
    const g = $('pGallery'), i = Math.round(g.scrollLeft / Math.max(1, g.clientWidth));
    $('pDots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  $('addBtn').addEventListener('click', () => {
    const needC = (cur.colors || []).length > 0;
    if ((needC && !selC) || !selS) {
      $('pErr').textContent = needC && !selC ? '컬러를 골라주세요.' : '사이즈를 골라주세요.';
      $('pErr').hidden = false; return;
    }
    cart = L.addLine(cart, cur, needC ? selC : '', selS); save(); bar(true); hide('pSheet');
    toast(`${cur.name}을(를) 쇼핑백에 담았어요`);
  });

  /* ---------- 쇼핑백 · 주문서 ---------- */
  function drawCart() {
    const empty = !cart.length;
    $('orderForm').hidden = empty;
    $('lines').innerHTML = empty
      ? `<p class="empty">쇼핑백이 비어 있어요.<br><a href="#shop" data-close>이번 주 신상 보러 가기</a></p>`
      : cart.map((x, i) => {
        const p = byId(x.id);
        return `<div class="line"><img src="${src(p.img)}" alt="" width="64" height="80">
          <div><div class="nm">${esc(x.name)}</div><small>${esc([x.color, x.size].filter(Boolean).join(' · '))}</small>
            <div class="qty"><button type="button" data-q="-1" data-i="${i}" aria-label="${esc(x.name)} 하나 빼기">−</button><span>${x.q}</span><button type="button" data-q="1" data-i="${i}" aria-label="${esc(x.name)} 하나 더">+</button></div></div>
          <div class="pr">${x.price > 0 ? L.won(x.price * x.q) : '가격 문의'}</div></div>`;
      }).join('');
    const t = L.totals(cart, C.shipping, pickup());
    $('tot').innerHTML = t.unpriced
      ? `<div><span>택배비</span><span>${t.ship === 0 ? '없음 (픽업)' : '확인 후 안내'}</span></div>
         <div class="all"><span>입금하실 금액</span><span>사장님이 확인 후 안내</span></div>`
      : `<div><span>상품</span><span>${L.won(t.sub)}</span></div>
         <div><span>택배비</span><span>${t.ship ? L.won(t.ship) : '무료'}</span></div>
         <div class="all"><span>입금하실 금액</span><span>${L.won(t.all)}</span></div>`;
    $('addrBox').hidden = pickup();
  }
  $('lines').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    cart = L.changeQty(cart, +b.dataset.i, +b.dataset.q); save(); bar(); drawCart();
  });
  document.querySelectorAll('input[name="ship"]').forEach(r => r.addEventListener('change', drawCart));
  $('orderForm').addEventListener('input', () => { $('oErr').hidden = true; });
  const openBag = () => { drawCart(); show('cSheet'); };
  $('openCart').addEventListener('click', openBag);
  $('bagBtn').addEventListener('click', openBag);

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
  function show(id) {
    if (!document.querySelector('.sheet:not([hidden])')) lastFocus = document.activeElement;
    $(id).hidden = false; document.body.style.overflow = 'hidden';
    const f = $(id).querySelector('.x'); if (f) f.focus({ preventScroll: true });
  }
  function hide(id) {
    $(id).hidden = true;
    if (!document.querySelector('.sheet:not([hidden])')) { document.body.style.overflow = ''; if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true }); }
  }
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => {
    if (e.target === s || e.target.closest('[data-close]')) hide(s.id);
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet:not([hidden])').forEach(s => hide(s.id)); });

  render(); bar();
})();
