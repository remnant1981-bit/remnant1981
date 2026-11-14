/* 메종도로시 화면 — 설정(config.js)과 로직(logic.js)을 읽어 그림. 상품은 구글 시트(productsUrl)가 있으면 그쪽이 우선 */
window.DorothyApp = function (opt) {
  'use strict';
  let loading = !!(opt && opt.loading);   // 시트 상품표를 기다리는 중이면 회색 로딩 카드 표시
  const C = window.DOROTHY, L = window.DLogic, S = C.store;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CART_KEY = 'dorothy-cart';
  const byId = id => C.products.find(p => p.id === id);
  let askUrl = '', askName = '';   // 문의 창구: 카톡채널 > 인스타 DM (설정 탭이 오면 바뀔 수 있음)
  const src = f => (/^https:/.test(f) ? f : (window.__IMG && window.__IMG[f]) || `images/${f}`);   // 시트의 https 사진 / 미리보기 번들 내장 이미지 / images 폴더
  const arrow = '<svg><use href="#i-arrow"/></svg>';
  const thumb = f => (/^https:/.test(f) ? f : (window.__IMG && window.__IMG['t/' + f]) || `images/t/${f}`);   // 작은 정사각 썸네일(180px)
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } };
  const wish = new Set(load('dorothy-wish', []));   // 없는 상품은 그릴 때 거름 (시트 상품표가 늦게 와도 찜 유지)
  let recent = load('dorothy-recent', []);
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* 미지원 */ } };

  /* ---------- 매장 정보 ---------- */
  $('previewBar').hidden = !C.preview;
  $('storeName').textContent = S.name;
  $('tagline').textContent = S.tagline + '. ' + S.intro;
  $('footTag').textContent = S.tagline;
  $('addr').textContent = S.address;
  $('landmark').textContent = S.landmark;
  $('biz').textContent = S.business;
  $('shipInfo').textContent = `${L.won(C.shipping.fee)}, ${L.won(C.shipping.freeOver)} 이상 무료예요. 매장 픽업은 택배비가 없어요. 입금 다음 날 발송합니다.`;
  $('shipSmall').textContent = `${L.won(C.shipping.fee)} · ${C.shipping.freeOver / 10000}만원 이상 무료`;
  function link(id, href) { const a = $(id); a.hidden = !href; if (href) a.href = href; }
  // 매장 정보(공지·영업시간·연락처) — 처음과, 시트 설정 탭이 도착했을 때 다시 그림
  function applyStore() {
    askUrl = S.kakaoUrl || S.dmUrl || S.instagram; askName = S.kakaoUrl ? '카톡' : 'DM';
    $('notice').textContent = S.notice || ''; $('notice').hidden = !S.notice;
    $('hours').textContent = S.hours;
    link('ctaAsk', askUrl);
    link('qMap', S.mapUrl);
    link('qInsta', S.instagram);
    link('qBand', S.bandUrl);
    link('qPhone', S.phone ? 'tel:' + S.phone.replace(/[^0-9]/g, '') : '');
    link('dAsk', askUrl);
    $('dAsk').textContent = `${askName}으로 보내기`;
  }
  applyStore();

  const st = C.story;
  if (st) {
    $('storyImg').src = src(st.photo); $('storyImg').alt = st.photoAlt;
    $('storyTitle').textContent = st.quote; $('storyBy').textContent = '— ' + st.by; $('storyText').textContent = st.text;
  } else document.querySelector('.story').hidden = true;

  const topbar = $('topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- 상품 카드 ---------- */
  const img = (file, alt, lazy = true, cls = '') => !file ? '' : `<img${cls ? ` class="${cls}"` : ''} src="${src(file)}" alt="${esc(alt)}" width="720" height="900"${lazy ? ' loading="lazy" decoding="async"' : ''}>`;
  const tag = p => p.soldOut ? '<span class="tag out">Sold out</span>'
    : p.stock > 0 && p.stock <= 2 ? `<span class="tag last">마지막 ${p.stock}벌</span>`
    : p.badge === 'NEW' ? '<span class="tag">New</span>'
    : p.badge ? `<span class="tag rec">${esc(p.badge)}</span>` : '';
  const card = (p, i = 9) => `
    <div class="card">
      <button type="button" class="hit" data-open="${esc(p.id)}"${p.soldOut ? ' disabled' : ''}>
        <div class="ph">${img(p.img, p.name, i > 3)}${p.gallery && p.gallery[0] ? img(p.gallery[0], '', true, 'alt') : ''}${tag(p)}<span class="quick">자세히 보기</span></div>
        <span class="nm">${esc(p.name)}</span>
        <span class="pr${L.hasPrice(p) ? '' : ' ask'}">${L.priceLabel(p)}</span>
        <span class="fit">${esc(L.fitLabel(p))}</span>
      </button>
      <button type="button" class="heart" data-heart="${esc(p.id)}" aria-pressed="${wish.has(p.id)}" aria-label="${esc(p.name)} 찜하기"><svg><use href="#i-heart"/></svg></button>
    </div>`;

  /* ---------- 로딩 카드 (시트 상품표를 기다리는 동안) ---------- */
  const skel = n => Array.from({ length: n }, () => '<div class="card sk" aria-hidden="true"><div class="ph"></div><span class="sk-line"></span><span class="sk-line short"></span></div>').join('');

  /* ---------- 사장님 픽 ---------- */
  let pick = null, looks = [];
  function renderPick() {
  $('pick').hidden = false;
  pick = loading ? null : byId(C.pick);
  if (loading) { $('pick').innerHTML = '<div class="ph sk-box" aria-hidden="true"></div><div class="pick-txt" aria-hidden="true"><span class="sk-line short"></span><span class="sk-line big"></span><span class="sk-line"></span></div>'; return; }
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
  }
  renderPick();

  /* ---------- 코디 ---------- */
  function renderLooks() {
  looks = loading ? [] : (C.looks || []).filter(l => l.items.some(id => byId(id)));
  $('looks').hidden = !loading && !looks.length;
  if (loading) { $('looksList').innerHTML = skel(2); return; }
  $('looksList').innerHTML = looks.map((l, i) => `
    <button type="button" class="look" data-open="${esc(l.items[0])}">
      <div class="ph">${img(l.img, l.title)}<span class="num">${String(i + 1).padStart(2, '0')}</span></div>
      <h3>${esc(l.title)}</h3>
      <p>${esc(l.note)}</p>
      <span class="go">${l.items.filter(id => byId(id)).map(id => esc(byId(id).name)).join(' + ')} 보기${arrow}</span>
    </button>`).join('');
  }
  renderLooks();

  /* ---------- 필터 ---------- */
  let cat = 'all', mySize = 0;
  try { mySize = Number(localStorage.getItem('dorothy-size')) || 0; } catch (e) { /* 없음 */ }
  const cats = () => [...new Set([...(C.categories || []), ...C.products.map(p => p.cat)])].filter(c => C.products.some(p => p.cat === c));
  $('filters').innerHTML = ['all', ...cats()]
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
    $('grid').setAttribute('aria-busy', String(loading));
    if (loading) { $('count').textContent = '새 옷을 불러오는 중…'; $('grid').innerHTML = skel(4); return; }
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
  if (!loading) cart = cart.filter(x => { const p = byId(x.id); return p && !p.soldOut; })
    .map(x => ({ ...x, price: L.hasPrice(byId(x.id)) ? byId(x.id).price : null }));
  const save = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* 저장 불가 */ } };
  const pickup = () => $('shipPick').checked;
  function bar(bump) {
    const t = L.totals(cart, C.shipping, false);
    $('bagCount').hidden = !t.count; $('bagCount').textContent = t.count;
    if (bump) { $('bagCount').classList.remove('bump'); void $('bagCount').offsetWidth; $('bagCount').classList.add('bump'); }
    $('tabBagCount').hidden = !t.count; $('tabBagCount').textContent = t.count;
    if (bump) { $('tabBagCount').classList.remove('bump'); void $('tabBagCount').offsetWidth; $('tabBagCount').classList.add('bump'); }
  }
  let toastTimer = 0;
  function toast(msg, action) {
    $('toastMsg').textContent = msg; $('toastGo').hidden = !action; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, action ? 3200 : 2000);
  }
  $('toastGo').addEventListener('click', () => { $('toast').hidden = true; openBag(); });

  /* ---------- 찜 ---------- */
  function syncWish() {
    const n = [...wish].filter(id => byId(id)).length;
    $('wishCount').hidden = !n; $('wishCount').textContent = n;
    document.querySelectorAll('[data-heart]').forEach(b => b.setAttribute('aria-pressed', String(wish.has(b.dataset.heart))));
    if (cur) $('pHeart').setAttribute('aria-pressed', String(wish.has(cur.id)));
  }
  function toggleWish(id, btn) {
    if (wish.has(id)) wish.delete(id); else { wish.add(id); buzz(); }
    store('dorothy-wish', [...wish]); syncWish();
    if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    if (!$('wSheet').hidden) drawWish();
    toast(wish.has(id) ? '찜했어요. 아래 찜 탭에서 모아볼 수 있어요' : '찜을 해제했어요');
  }
  document.addEventListener('click', e => { const h = e.target.closest('[data-heart]'); if (h) toggleWish(h.dataset.heart, h); });
  function drawWish() {
    const list = [...wish].map(byId).filter(Boolean);
    $('wishList').innerHTML = list.length ? list.map(p => card(p)).join('')
      : '<p class="empty">마음에 드는 옷의 ♡를 눌러 모아보세요.<br><a href="#shop" data-close>신상 보러 가기</a></p>';
  }
  $('tabWish').addEventListener('click', () => { drawWish(); show('wSheet'); });

  /* ---------- 최근 본 옷 ---------- */
  function drawRecent() {
    const list = recent.map(byId).filter(Boolean);
    $('recent').hidden = list.length < 2;
    $('recentList').innerHTML = list.map(p => `<button type="button" class="mini" data-open="${esc(p.id)}"><img src="${src(p.img)}" alt="" width="96" height="120" loading="lazy" decoding="async"><span>${esc(p.name)}</span></button>`).join('');
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
  function openProduct(id, opt = {}) {
    const next = byId(id); if (!next) return;
    const already = !$('pSheet').hidden;
    cur = next;
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
    $('addBtn').textContent = L.hasPrice(cur) ? '쇼핑백에 담기' : '담기 · 가격은 확인 후 안내';
    $('pHeart').setAttribute('aria-pressed', String(wish.has(cur.id)));
    recent = [cur.id, ...recent.filter(x => x !== cur.id)].slice(0, 10); store('dorothy-recent', recent); drawRecent();
    const url = `${baseUrl}#p-${cur.id}`;
    if (already) history.replaceState({ layer: 'pSheet' }, '', url); else show('pSheet', { url, replace: opt.replace });
    $('pSheet').querySelector('.panel').scrollTop = 0;
  }
  $('pHeart').addEventListener('click', () => toggleWish(cur.id, $('pHeart')));
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
    cart = L.addLine(cart, cur, needC ? selC : '', selS); save(); bar(true); hide('pSheet'); buzz();
    toast('쇼핑백에 담았어요', true);
  });

  /* ---------- 쇼핑백 · 주문서 ---------- */
  function drawCart() {
    const empty = !cart.length;
    $('orderForm').hidden = empty;
    $('lines').innerHTML = empty
      ? `<p class="empty">쇼핑백이 비어 있어요.<br><a href="#shop" data-close>이번 주 신상 보러 가기</a></p>`
      : cart.map((x, i) => {
        const p = byId(x.id);
        return `<div class="bline"><img src="${src(p.img)}" alt="" width="64" height="80" loading="lazy">
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
    const leftWon = L.freeShipLeft(cart, C.shipping), sub = L.totals(cart, C.shipping, false).sub;
    const showFree = !empty && !t.unpriced && !pickup();
    $('freeship').hidden = !showFree;
    if (showFree) {
      $('freeshipTxt').innerHTML = leftWon ? `<b>${L.won(leftWon)}</b> 더 담으면 무료배송이에요` : '무료배송으로 보내드려요';
      $('freeshipBar').style.width = `${Math.min(100, sub / C.shipping.freeOver * 100)}%`;
    }
  }
  $('lines').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    cart = L.changeQty(cart, +b.dataset.i, +b.dataset.q); save(); bar(); drawCart();
  });
  document.querySelectorAll('input[name="ship"]').forEach(r => r.addEventListener('change', drawCart));
  $('orderForm').addEventListener('input', () => { $('oErr').hidden = true; });
  function openBag() { drawCart(); show('cSheet'); }
  $('bagBtn').addEventListener('click', openBag);
  $('tabBag').addEventListener('click', openBag);

  $('orderForm').addEventListener('submit', async e => {
    e.preventDefault();
    const o = { ad: $('oAd').checked, name: $('oName').value, phone: $('oPhone').value, pickup: pickup(), address: [$('oAddr').value.trim(), $('oAddr2').value.trim()].filter(Boolean).join(' '), memo: $('oMemo').value, agree: $('oAgree').checked };
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
    swap('cSheet', 'dSheet');
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

  /* ---------- 시트 열고 닫기 (뒤로가기로 닫힘) ---------- */
  const baseUrl = location.href.split('#')[0];
  const layers = [];
  let lastFocus = null;
  function show(id, opt = {}) {
    if (!layers.length) lastFocus = document.activeElement;
    layers.push(id);
    const el = $(id); el.hidden = false; el.style.zIndex = 50 + layers.length;
    document.body.style.overflow = 'hidden';
    const url = opt.url || (location.hash.startsWith('#p-') ? baseUrl : location.href);
    if (opt.replace) history.replaceState({ layer: id }, '', url); else history.pushState({ layer: id }, '', url);
    const f = el.querySelector('.x, .sv-x'); if (f) f.focus({ preventScroll: true });
  }
  function closeEl(id) {
    if (id === 'sv') clearTimeout(timer);
    $(id).hidden = true;
    const i = layers.lastIndexOf(id); if (i >= 0) layers.splice(i, 1);
    if (id === 'sv') drawStories();
    if (!layers.length) { document.body.style.overflow = ''; if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true }); }
  }
  function hide(id) {
    if (history.state && history.state.layer === id && layers[layers.length - 1] === id) history.back();   // popstate 에서 닫음
    else closeEl(id);
  }
  function swap(from, to, url) { closeEl(from); show(to, { replace: true, url }); }
  addEventListener('popstate', e => {
    const want = e.state && e.state.layer;
    while (layers.length && layers[layers.length - 1] !== want) closeEl(layers[layers.length - 1]);
  });
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (e.target !== s && !c) return;
    if (c && c.tagName === 'A') {   // 시트 안 링크: 닫은 뒤 해당 위치로 이동
      e.preventDefault(); const to = c.getAttribute('href'); hide(s.id);
      setTimeout(() => { const t = document.querySelector(to); if (t) t.scrollIntoView(); }, 80);
      return;
    }
    hide(s.id);
  }));
  document.addEventListener('keydown', e => {
    if (!layers.length) return;
    const top = $(layers[layers.length - 1]);
    if (e.key === 'Escape' && layers[layers.length - 1] !== 'sv') { hide(top.id); return; }
    if (e.key !== 'Tab') return;   // 열린 창 안에서만 포커스 이동
    const f = [...top.querySelectorAll('a[href],button,input,textarea,[tabindex="0"]')].filter(x => !x.disabled && !x.closest('[hidden]') && x.offsetParent !== null && x.tabIndex >= 0);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  /* ---------- 스토리 ---------- */
  const groups = [];
  function buildStories() {
  groups.length = 0;
  if (loading) return;
  if (pick) groups.push({ key: 'pick', name: '사장님 픽', cover: pick.img, slides: [{ img: pick.img, title: pick.name, text: pick.tip, open: pick.id }] });
  const fresh = C.products.filter(p => p.badge === 'NEW' && !p.soldOut);
  if (fresh.length) groups.push({ key: 'new', name: '이번 주 신상', cover: fresh[0].img, slides: fresh.map(p => ({ img: p.img, title: p.name, text: p.desc, open: p.id })) });
  looks.forEach((l, i) => groups.push({ key: 'look' + i, name: l.title, cover: l.img, slides: [{ img: l.img, title: l.title, text: l.note, open: l.items[0] }, ...l.items.map(byId).map(p => ({ img: p.img, title: p.name, text: p.tip, open: p.id }))] }));
  if (st) groups.push({ key: 'shop', name: '매장 이야기', cover: 'store.jpg', slides: [{ img: 'store.jpg', title: '내포 메종도로시', text: `${S.address} · ${S.landmark}` }, { img: st.photo, title: st.quote, text: st.text }] });
  }
  buildStories();
  const seen = new Set(load('dorothy-seen', []));
  function drawStories() {
    if (loading) { $('stories').innerHTML = Array.from({ length: 5 }, () => '<span class="st sk" aria-hidden="true"><span class="ring"></span><span class="sk-lines"><span class="sk-line"></span><span class="sk-line short"></span></span></span>').join(''); return; }
    $('stories').innerHTML = groups.map((g, i) => `<button type="button" class="st${seen.has(g.key) ? ' seen' : ''}" data-story="${i}"><span class="ring"><img src="${thumb(g.cover)}" alt="" width="60" height="60"></span><span>${esc(g.name)}</span></button>`).join('');
  }
  drawStories();
  let sg = 0, ss = 0, timer = 0, startAt = 0, left = 0, paused = false;
  const DUR = 5000;
  function svShow() {
    const g = groups[sg], sl = g.slides[ss];
    $('svGroup').textContent = g.name; $('svAv').style.backgroundImage = `url("${thumb(g.cover)}")`;
    $('svImg').src = src(sl.img); $('svImg').alt = sl.title;
    $('svTitle').textContent = sl.title; $('svText').textContent = sl.text || '';
    $('svGo').hidden = !sl.open;
    $('svBars').innerHTML = g.slides.map((_, k) => `<i class="${k < ss ? 'done' : ''}"><b></b></i>`).join('');
    seen.add(g.key); store('dorothy-seen', [...seen]);
    const nx = g.slides[ss + 1] || (groups[sg + 1] && groups[sg + 1].slides[0]); if (nx) new Image().src = src(nx.img);
    run(DUR);
  }
  function run(ms) {
    clearTimeout(timer); left = ms; startAt = Date.now(); paused = false;
    const b = $('svBars').children[ss].firstChild;
    b.style.transition = 'none'; b.style.width = `${100 - ms / DUR * 100}%`; void b.offsetWidth;
    b.style.transition = `width ${ms}ms linear`; b.style.width = '100%';
    timer = setTimeout(svNext, ms);
  }
  function pause() {
    if (paused) return; paused = true; clearTimeout(timer); left -= Date.now() - startAt;
    const b = $('svBars').children[ss].firstChild; b.style.width = getComputedStyle(b).width; b.style.transition = 'none';
  }
  function svNext() { if (ss < groups[sg].slides.length - 1) { ss++; svShow(); } else if (sg < groups.length - 1) { sg++; ss = 0; svShow(); } else svClose(); }
  function svPrev() { if (ss > 0) ss--; else if (sg > 0) { sg--; ss = 0; } svShow(); }
  function svOpen(i) { sg = i; ss = 0; show('sv'); svShow(); }
  function svClose() { hide('sv'); }
  $('stories').addEventListener('click', e => { const b = e.target.closest('[data-story]'); if (b) svOpen(+b.dataset.story); });
  $('svClose').addEventListener('click', svClose);
  let downAt = 0, downY = 0;
  ['svPrev', 'svNext'].forEach(id => {
    $(id).addEventListener('pointerdown', e => { downAt = Date.now(); downY = e.clientY; pause(); });
    $(id).addEventListener('pointercancel', () => run(left));
    $(id).addEventListener('pointerup', e => {
      if (e.clientY - downY > 80) { svClose(); return; }                 // 아래로 쓸어내리면 닫기
      if (Date.now() - downAt < 250) { id === 'svPrev' ? svPrev() : svNext(); } else run(left);   // 길게 누르면 멈춤
    });
  });
  $('svGo').addEventListener('click', () => { const id = groups[sg].slides[ss].open; closeEl('sv'); openProduct(id, { replace: true }); });
  document.addEventListener('keydown', e => {
    if ($('sv').hidden || layers[layers.length - 1] !== 'sv') return;
    if (e.key === 'Escape') svClose(); else if (e.key === 'ArrowRight') svNext(); else if (e.key === 'ArrowLeft') svPrev();
  });

  /* ---------- 하단 탭 현재 위치 ---------- */
  const tabs = [...document.querySelectorAll('.tabbar [data-tab]')];
  function tabState() {
    const y = scrollY + innerHeight * 0.35;
    const at = $('visit').offsetTop < y ? 'visit' : $('shop').offsetTop < y ? 'shop' : 'home';
    tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === at));
  }
  addEventListener('scroll', tabState, { passive: true });

  /* ---------- 시트를 아래로 쓸어 닫기 ---------- */
  document.querySelectorAll('.sheet .panel').forEach(panel => {
    let y0 = null, dy = 0;
    panel.addEventListener('touchstart', e => { y0 = panel.scrollTop <= 0 && innerWidth < 720 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    panel.addEventListener('touchmove', e => {
      if (y0 === null) return; dy = e.touches[0].clientY - y0;
      if (dy > 0) { panel.classList.add('dragging'); panel.style.transform = `translateY(${dy}px)`; }
    }, { passive: true });
    panel.addEventListener('touchend', () => {
      if (y0 === null) return; panel.classList.remove('dragging'); panel.style.transform = '';
      if (dy > 110) hide(panel.parentElement.id); y0 = null;
    });
  });

  /* ---------- 영업 상태 ---------- */
  function openNow() {
    if (!S.open) return;
    const o = L.openStatus(new Date(), S.open);
    $('heroOpen').hidden = false; $('heroOpen').textContent = o.text; $('heroOpen').classList.toggle('on', o.open);
    $('visitOpen').textContent = o.text; $('visitOpen').classList.toggle('on', o.open);
  }
  openNow(); setInterval(openNow, 60000);

  /* ---------- 복사·공유 ---------- */
  function copyText(text, okMsg) {
    const fail = () => toast(text);
    try { navigator.clipboard.writeText(text).then(() => toast(okMsg), fail); } catch (e) { fail(); }
  }
  $('copyAddr').addEventListener('click', () => copyText(S.address, '주소를 복사했어요'));
  $('pShare').addEventListener('click', async () => {
    const url = `${baseUrl}#p-${cur.id}`, data = { title: `${cur.name} | ${S.name}`, text: cur.tip, url };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    copyText(url, '링크를 복사했어요. 카톡에 붙여넣어 보내보세요');
  });

  /* ---------- 주문서 입력 도우미 ---------- */
  $('oPhone').addEventListener('input', e => {
    const el = e.target, end = el.selectionEnd === el.value.length;
    el.value = L.formatPhone(el.value); if (end) el.setSelectionRange(el.value.length, el.value.length);
  });
  // 우편번호 검색(다음 우편번호 서비스): 누를 때만 불러오고, 못 불러오면 직접 입력 안내
  let postReady = null;
  function loadPost() {
    if (postReady) return postReady;
    postReady = new Promise((ok, no) => {
      const sc = document.createElement('script');
      sc.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      sc.onload = () => (window.daum && window.daum.Postcode ? ok() : no()); sc.onerror = no;
      document.head.appendChild(sc); setTimeout(no, 5000);
    });
    postReady.catch(() => { postReady = null; });
    return postReady;
  }
  // 아이폰은 주소 검색창(외부 iframe)의 작은 글씨 입력칸을 누르면 화면이 확대되므로, 검색 중에만 확대를 막음
  const vp = document.querySelector('meta[name=viewport]'), vp0 = vp && vp.content;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const lockZoom = on => { if (vp && isIOS) vp.content = on ? vp0 + ',maximum-scale=1' : vp0; };
  $('findAddr').addEventListener('click', async () => {
    const layer = $('postLayer');
    if (!layer.hidden) { layer.hidden = true; lockZoom(false); return; }
    $('findAddr').textContent = '불러오는 중…';
    try {
      await loadPost();
      layer.hidden = false; layer.innerHTML = ''; lockZoom(true);
      new window.daum.Postcode({
        width: '100%', height: '100%',
        oncomplete: d => { $('oAddr').value = `${d.roadAddress || d.jibunAddress}${d.buildingName ? ` (${d.buildingName})` : ''}`; layer.hidden = true; lockZoom(false); $('oAddr2').focus(); }
      }).embed(layer);
    } catch (e) { toast('주소 검색을 불러오지 못했어요. 직접 입력해 주세요'); $('oAddr').focus(); }
    $('findAddr').textContent = '주소 찾기';
  });

  /* ---------- 공유 링크로 들어오면 그 옷을 바로 열기 (#p-상품id) ---------- */
  function openFromHash() {
    const m = location.hash.match(/^#p-([\w-]+)$/);
    if (!m || !byId(m[1]) || (cur && cur.id === m[1] && !$('pSheet').hidden)) return;
    history.replaceState(null, '', baseUrl); openProduct(m[1]);
  }
  addEventListener('hashchange', openFromHash);
  if (!loading) openFromHash();   // 로딩 중이면 상품표가 온 뒤에 열기

  render(); bar(); syncWish(); drawRecent(); tabState();

  // 시트에서 새 상품표가 오면 목록만 다시 그림 (스토리·사장님 픽은 다음 방문부터 반영)
  return {
    update(list, settings) {
      if (settings) { Object.assign(S, settings); applyStore(); openNow(); }
      const wasLoading = loading; loading = false;
      C.products = list;
      if (cat !== 'all' && !list.some(p => p.cat === cat)) cat = 'all';
      $('filters').innerHTML = ['all', ...cats()].map(c => `<button type="button" data-v="${esc(c)}" aria-pressed="${c === cat}">${c === 'all' ? '전체' : esc(c)}</button>`).join('');
      cart = cart.filter(x => byId(x.id) && !byId(x.id).soldOut).map(x => ({ ...x, price: L.hasPrice(byId(x.id)) ? byId(x.id).price : null }));
      renderPick(); renderLooks(); buildStories(); drawStories();
      if (wasLoading) openFromHash();
      save(); render(); bar(); syncWish(); drawRecent();
    }
  };
};

/* ---------- 시작 ----------
 * 화면은 바로 띄우고 상품은 구글 시트(상품·설정 탭)에서 받아 채움. 시트 응답은 보통 2~3초 걸림
 * 1) 지난번에 받아 둔 내용이 있으면 그걸로 바로 보여주고, 뒤에서 새로 받아 바뀐 부분만 갱신
 * 2) 처음 온 손님은 상품 자리에 로딩 카드를 보여주다가 도착하면 교체 (8초 안에 못 받으면 config.js 상품) */
(function boot() {
  const C = window.DOROTHY, L = window.DLogic, KEY = 'dorothy-sheet';
  if (!C.productsUrl) { window.DorothyApp(); return; }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cached = null; }
  if (Array.isArray(cached)) cached = { products: cached };   // 이전 저장 형식
  const fetchSheet = ms => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    return fetch(C.productsUrl + (C.productsUrl.includes('?') ? '&' : '?') + 'products=1', { signal: ctl.signal, cache: 'no-store' })
      .then(r => r.json()).then(d => ({ products: L.parseSheet(d && d.rows), settings: L.parseSettings(d && d.settings) }))
      .catch(() => null).finally(() => clearTimeout(t));
  };
  const keep = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } };
  const fallback = C.products;
  if (cached && cached.products && cached.products.length) {
    C.products = cached.products; if (cached.settings) Object.assign(C.store, cached.settings);
    const app = window.DorothyApp();
    fetchSheet(10000).then(v => {
      if (!v || !v.products) return;
      keep(v);
      const changed = JSON.stringify(v.products) !== JSON.stringify(cached.products);
      const sChanged = JSON.stringify(v.settings) !== JSON.stringify(cached.settings);
      if (changed || sChanged) app.update(v.products, v.settings);
    });
  } else {
    const app = window.DorothyApp({ loading: true });
    fetchSheet(8000).then(v => {
      if (v && v.products) { keep(v); app.update(v.products, v.settings); }
      else app.update(fallback);
    });
  }
})();
