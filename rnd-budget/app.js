// 화면 처리. 계산은 logic.js(RB), 설정은 config.js(RB_CONFIG)
(function () {
  'use strict';
  const RB = window.RB, CFG = window.RB_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
  };
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.forEach((c) => e.append(c));
    return e;
  };

  const blank = () => ({
    title: '', gov: '', orgType: 'sme', govMaxPct: 75, cashMinPct: 10, indirectPct: RB.DEFAULT_RULES.indirectPct, allowanceMaxPct: RB.DEFAULT_RULES.allowanceMaxPct,
    people: [{ name: '', salary: '', months: 12, rate: '', otherRate: '', inkind: false }],
    items: {},
  });
  let S = Object.assign(blank(), store.get('rb.current', {}));
  const save = () => store.set('rb.current', S);

  // ---------- 1. 정부출연금 ----------
  const orgSel = $('orgType');
  for (const [k, v] of Object.entries(RB.ORG_TYPES)) orgSel.append(el('option', { value: k, text: v.label }));
  const bindField = (id, key) => {
    const i = $(id);
    i.value = S[key] ?? '';
    i.addEventListener('input', () => { S[key] = i.value; if (key === 'gov') i.value = groupDigits(i.value); update(); });
  };
  function groupDigits(v) { const n = RB.int(v); return n ? fmt(n) : String(v).replace(/[^\d]/g, ''); }
  bindField('title', 'title'); bindField('gov', 'gov'); bindField('govMaxPct', 'govMaxPct'); bindField('cashMinPct', 'cashMinPct'); bindField('indirectPct', 'indirectPct'); bindField('allowanceMaxPct', 'allowanceMaxPct');
  $('gov').value = groupDigits(S.gov);
  orgSel.value = S.orgType;
  orgSel.addEventListener('change', () => {
    S.orgType = orgSel.value;
    const t = RB.ORG_TYPES[S.orgType];
    if (S.orgType !== 'custom') { S.govMaxPct = t.govMaxPct; S.cashMinPct = t.cashMinPct; $('govMaxPct').value = t.govMaxPct; $('cashMinPct').value = t.cashMinPct; }
    else document.querySelector('.rules').open = true;
    update();
  });

  // ---------- 2. 참여연구원 ----------
  const pBody = $('people').querySelector('tbody');
  function renderPeople() {
    pBody.replaceChildren();
    S.people.forEach((p, idx) => {
      const inp = (key, attrs = {}) => el('input', { value: p[key] ?? '', 'aria-label': attrs.label, inputmode: attrs.mode || 'numeric', maxlength: attrs.max || 12,
        oninput: (e) => { p[key] = e.target.value; update(); } });
      const cost = el('td', { 'data-cost': idx, 'data-label': '인건비(천원)' });
      pBody.append(el('tr', {},
        el('td', { 'data-label': '성명' }, inp('name', { label: `연구원 ${idx + 1} 성명`, mode: 'text', max: 20 })),
        el('td', { 'data-label': '연봉(천원)' }, inp('salary', { label: `연구원 ${idx + 1} 연봉(천원)` })),
        el('td', { 'data-label': '참여개월' }, inp('months', { label: `연구원 ${idx + 1} 참여개월` })),
        el('td', { 'data-label': '참여율(%)' }, inp('rate', { label: `연구원 ${idx + 1} 참여율` })),
        el('td', { 'data-label': '다른 과제 참여율(%)' }, inp('otherRate', { label: `연구원 ${idx + 1} 다른 과제 참여율` })),
        el('td', { 'data-label': '현물(기존 인력)' }, el('input', { type: 'checkbox', checked: !!p.inkind, 'aria-label': `연구원 ${idx + 1} 현물(기존 인력)`, onchange: (e) => { p.inkind = e.target.checked; update(); } })),
        cost,
        el('td', { class: 'del' }, el('button', { type: 'button', class: 'icon', 'aria-label': `연구원 ${idx + 1} 삭제`, text: '✕', onclick: () => { S.people.splice(idx, 1); renderPeople(); update(); } })),
      ));
    });
  }
  $('addPerson').addEventListener('click', () => {
    if (S.people.length >= 50) return;
    S.people.push({ name: '', salary: '', months: 12, rate: '', otherRate: '', inkind: false });
    renderPeople(); update();
    pBody.lastElementChild.querySelector('input').focus();
  });

  // ---------- 3. 비목 ----------
  const iBody = $('items').querySelector('tbody'), iFoot = $('items').querySelector('tfoot');
  const cells = {};
  function renderItems() {
    iBody.replaceChildren();
    for (const it of [...RB.ITEMS, { key: 'indirect', label: '간접비' }]) {
      const v = (S.items[it.key] ||= {});
      const auto = it.key === 'personnel' || it.key === 'indirect';
      const num = (side) => {
        if (auto || (side === 'inkind' && !it.inkind)) return el('td', { 'data-cell': `${it.key}.${side}` });
        const i = el('input', { value: groupDigits(v[side] ?? ''), inputmode: 'numeric', maxlength: 14, 'aria-label': `${it.label} ${side === 'cash' ? '현금' : '현물'}(천원)`,
          oninput: (e) => { v[side] = e.target.value; e.target.value = groupDigits(e.target.value); update(); } });
        return el('td', {}, i);
      };
      const label = el('td', {}, it.label);
      if (auto) label.append(' ', el('span', { class: 'computed', text: it.key === 'personnel' ? '(2번에서 계산)' : '(자동 계산)' }));
      const row = el('tr', {}, label, num('cash'), num('inkind'), el('td', { 'data-cell': `${it.key}.total` }), el('td', { 'data-cell': `${it.key}.share` }));
      iBody.append(row);
    }
    iBody.querySelectorAll('[data-cell]').forEach((c) => { cells[c.dataset.cell] = c; });
  }

  // ---------- 계산·표시 ----------
  function update() {
    const r = RB.calcBudget(S);
    const f = r.funding;
    $('funding').replaceChildren(...[
      ['최소 총사업비', f.total], ['기관부담금(최소)', f.org], ['그중 현금(최소)', f.cashMin], ['현물(최대)', f.inkindMax],
    ].map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: `${fmt(v)}천원` }))));
    r.people.forEach((p, i) => { const c = pBody.querySelector(`[data-cost="${i}"]`); if (c) c.textContent = fmt(p.cost); });
    for (const row of r.rows) {
      for (const side of ['cash', 'inkind']) if (cells[`${row.key}.${side}`]) cells[`${row.key}.${side}`].textContent = fmt(row[side]);
      cells[`${row.key}.total`].textContent = fmt(row.total);
      cells[`${row.key}.share`].textContent = r.total.total ? `${((row.total / r.total.total) * 100).toFixed(1)}%` : '-';
    }
    iFoot.replaceChildren(el('tr', {}, el('td', { text: '합계' }), el('td', { text: fmt(r.total.cash) }), el('td', { text: fmt(r.total.inkind) }), el('td', { text: fmt(r.total.total) }), el('td', { text: r.total.total ? '100%' : '-' })));
    $('checks').replaceChildren(...r.checks.map((c) => el('li', { class: c.level, text: c.msg })));
    save();
    return r;
  }

  $('print').addEventListener('click', () => window.print());
  $('reset').addEventListener('click', () => {
    if (!confirm('입력한 내용을 모두 지울까요?')) return;
    S = blank(); save(); location.reload();
  });

  // ---------- 광고(설정 시에만) ----------
  if (CFG.adsenseClient && CFG.adsenseSlot && !store.get('rb.license', null)) {
    const ad = $('ad');
    ad.hidden = false;
    ad.append(el('ins', { class: 'adsbygoogle', style: 'display:block', 'data-ad-client': CFG.adsenseClient, 'data-ad-slot': CFG.adsenseSlot, 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' }));
    const s = el('script', { async: true, src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CFG.adsenseClient)}`, crossorigin: 'anonymous' });
    s.addEventListener('load', () => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* 광고 차단 등 */ } });
    document.head.append(s);
  }

  // ---------- Pro 이용권 ----------
  const REASONS = { not_ready: '이용권 판매 준비 중입니다.', format: '코드 형식이 올바르지 않습니다. 받은 코드를 그대로 붙여 넣으세요.', signature: '유효하지 않은 코드입니다.', expired: '이용 기간이 끝난 코드입니다.' };
  $('price').textContent = CFG.licensePublicKey ? (CFG.priceText || '') : '';
  $('price').hidden = !$('price').textContent;
  const buy = $('buy');
  if (CFG.storeUrl && CFG.licensePublicKey) buy.href = CFG.storeUrl; else { buy.setAttribute('aria-disabled', 'true'); buy.removeAttribute('target'); buy.addEventListener('click', (e) => e.preventDefault()); buy.textContent = '판매 준비 중'; }
  if (CFG.contact) $('contact').textContent = `문의: ${CFG.contact}`;

  async function applyLicense(code, quiet) {
    const v = await RB.verifyLicense(code, CFG.licensePublicKey, today());
    const on = v.ok;
    $('proLocked').hidden = on; $('proTools').hidden = !on;
    $('proBadge').textContent = on ? '사용 중' : '';
    if (on) { store.set('rb.license', code.trim()); $('proInfo').textContent = `이용권 ${v.id} · ${v.exp}까지`; renderScenarios(); }
    else if (!quiet) $('licenseMsg').textContent = REASONS[v.reason] || REASONS.format;
    if (!on && v.reason === 'expired') { store.del('rb.license'); $('licenseMsg').textContent = `${REASONS.expired}(${v.exp}) 새 이용권을 등록하세요.`; }
    return on;
  }
  $('activate').addEventListener('click', async () => { if (await applyLicense($('licenseCode').value, false)) $('licenseMsg').textContent = ''; });
  const saved = store.get('rb.license', null);
  if (saved) applyLicense(saved, true);

  $('xlsx').addEventListener('click', () => {
    const bytes = RB.buildXlsx(S, S.title ? `${S.title} 사업비 편성표` : 'R&D 사업비 편성표');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = el('a', { href: url, download: `${(S.title || '사업비편성표').replace(/[\\/:*?"<>|]/g, '_')}_${today()}.xlsx` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  const MAX_SCEN = 20;
  function renderScenarios() {
    const list = store.get('rb.scenarios', []);
    $('scenarios').replaceChildren(...list.map((sc, i) => {
      const r = RB.calcBudget(sc.state);
      return el('li', {},
        el('span', {}, el('strong', { text: sc.name }), ' ', el('span', { class: 'meta', text: `정부 ${fmt(r.funding.gov)} · 총 ${fmt(r.total.total)}천원 · ${sc.savedAt}` })),
        el('span', {},
          el('button', { type: 'button', class: 'btn ghost', text: '불러오기', onclick: () => { if (confirm(`'${sc.name}'을 불러올까요? 현재 입력은 바뀝니다.`)) { S = Object.assign(blank(), sc.state); save(); location.reload(); } } }), ' ',
          el('button', { type: 'button', class: 'icon', 'aria-label': `${sc.name} 삭제`, text: '✕', onclick: () => { list.splice(i, 1); store.set('rb.scenarios', list); renderScenarios(); } })));
    }));
  }
  $('saveScenario').addEventListener('click', () => {
    const list = store.get('rb.scenarios', []);
    if (list.length >= MAX_SCEN) { alert(`최대 ${MAX_SCEN}개까지 저장할 수 있습니다. 기존 안을 삭제하세요.`); return; }
    const name = (prompt('저장할 이름', S.title || `안 ${list.length + 1}`) || '').trim().slice(0, 40);
    if (!name) return;
    list.unshift({ name, savedAt: today(), state: JSON.parse(JSON.stringify(S)) });
    if (!store.set('rb.scenarios', list)) alert('브라우저 저장 공간에 저장하지 못했습니다.');
    renderScenarios();
  });

  renderPeople(); renderItems(); update();
})();
