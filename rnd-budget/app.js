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
  };
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.forEach((c) => e.append(c));
    return e;
  };
  const groupDigits = (v) => { const n = RB.int(v); return n ? fmt(n) : String(v ?? '').replace(/[^\d]/g, ''); };

  const blank = () => ({
    ruleset: 'sme', title: '', gov: '', govMaxPct: '', cashMinPct: '', indirectPct: '', allowanceMaxPct: '',
    people: [{ name: '', salary: '', months: 12, rate: '', otherRate: '', kind: 'existing' }],
    items: {},
  });
  // 이전 버전 저장값(orgType) 호환
  const loaded = store.get('rb.current', {});
  if (loaded.orgType && !loaded.ruleset) loaded.ruleset = { sme: 'sme', mid: 'midL', large: 'large', custom: 'custom' }[loaded.orgType] || 'sme';
  let S = Object.assign(blank(), loaded);
  if (!RB.RULESETS[S.ruleset]) S.ruleset = 'sme';
  const save = () => store.set('rb.current', S);

  $('basisLine').textContent = `적용 법령: ${RB.SOURCES.decreeT1} · ${RB.SOURCES.std} — 기준일 ${RB.BASIS_DATE}`;
  $('foot').textContent = `본 도구는 참고용입니다. 사업별 공고문·부처 운영요령·협약이 우선하며, 최종 편성은 전문기관 기준을 확인하세요. 법령 기준일 ${RB.BASIS_DATE}.${CFG.contact ? ` 문의: ${CFG.contact}` : ''}`;

  // ---------- 1. 기관 유형·적용 기준 ----------
  const sel = $('ruleset');
  const groups = [['기업(영리기관)', ['sme', 'midS', 'midL', 'large']], ['비영리기관', ['univ', 'nonprofit']], ['기타', ['custom']]];
  for (const [g, keys] of groups) sel.append(el('optgroup', { label: g }, ...keys.map((k) => el('option', { value: k, text: RB.RULESETS[k].label }))));
  sel.value = S.ruleset;
  const RULE_INPUTS = ['govMaxPct', 'cashMinPct', 'indirectPct', 'allowanceMaxPct'];

  function syncRuleInputs() {
    const rs = RB.RULESETS[S.ruleset];
    const eff = RB.effectiveRules(S);
    const custom = !!rs.custom;
    for (const id of RULE_INPUTS) {
      const i = $(id);
      const editable = custom || id === 'indirectPct';
      i.readOnly = !editable;
      i.classList.toggle('locked', !editable);
      i.title = editable ? '' : '법령 기준 고정값';
      const v = id === 'allowanceMaxPct' ? eff.allowancePct : eff[id];
      if (document.activeElement !== i) i.value = v;
    }
    document.querySelectorAll('[data-basis]').forEach((td) => { td.textContent = rs.basis[td.dataset.basis]; });
    $('ruleMode').textContent = custom ? '공고문 기준 직접 입력' : '법령 기준 고정';
    $('ruleMode').classList.toggle('warn', custom);
    $('ruleHint').textContent = custom
      ? '공고문·운영요령에 적힌 비율을 입력하세요. 법령 기준과 다를 수 있으므로 공고문 해당 조항을 확인하세요.'
      : rs.profit
        ? `🔒 표시 값은 법령 기준으로 고정됩니다. 간접비율은 기관 간접비 고시비율 범위(최대 ${rs.indirectMax}%) 안에서 낮출 수 있습니다.`
        : '🔒 비영리기관은 기관부담 의무가 없습니다. 간접비율은 기관 고시비율이 있으면 그 값으로 바꾸세요.';
  }
  sel.addEventListener('change', () => {
    const prevKey = S.ruleset;
    S.ruleset = sel.value;
    if (RB.RULESETS[S.ruleset].custom) { // 직접 입력 시작값 = 직전 법령 기준
      const eff = RB.effectiveRules({ ...S, ruleset: prevKey });
      S.govMaxPct = eff.govMaxPct; S.cashMinPct = eff.cashMinPct; S.indirectPct = eff.indirectPct; S.allowanceMaxPct = eff.allowancePct;
    } else S.indirectPct = '';
    syncRuleInputs(); renderItems(); update();
  });
  for (const id of RULE_INPUTS) $(id).addEventListener('input', (e) => { if (!e.target.readOnly) { S[id] = e.target.value; update(); } });
  $('indirectPct').addEventListener('blur', syncRuleInputs); // 상한 초과 입력 시 상한값으로 표시

  const bind = (id, key, digits) => {
    const i = $(id);
    i.value = digits ? groupDigits(S[key]) : S[key] ?? '';
    i.addEventListener('input', () => { S[key] = i.value; if (digits) i.value = groupDigits(i.value); update(); });
  };
  bind('title', 'title'); bind('gov', 'gov', true);

  // ---------- 2. 참여연구원 ----------
  const pBody = $('people').querySelector('tbody');
  function renderPeople() {
    pBody.replaceChildren();
    S.people.forEach((p, idx) => {
      p.kind ||= p.inkind ? 'existing' : 'new';
      const n = idx + 1;
      const inp = (key, label, mode = 'numeric', max = 12) => el('input', { value: key === 'salary' ? groupDigits(p[key]) : p[key] ?? '', 'aria-label': `연구원 ${n} ${label}`, inputmode: mode, maxlength: max,
        oninput: (e) => { p[key] = e.target.value; if (key === 'salary') e.target.value = groupDigits(e.target.value); update(); } });
      const kind = el('select', { 'aria-label': `연구원 ${n} 구분`, onchange: (e) => { p.kind = e.target.value; update(); } },
        ...Object.entries(RB.PERSON_KINDS).map(([k, v]) => el('option', { value: k, text: v.label, selected: p.kind === k })));
      pBody.append(el('tr', {},
        el('td', { 'data-label': '성명' }, inp('name', '성명', 'text', 20)),
        el('td', { 'data-label': '연봉(천원)' }, inp('salary', '연봉(천원)')),
        el('td', { 'data-label': '참여개월' }, inp('months', '참여개월')),
        el('td', { 'data-label': '참여율(%)' }, inp('rate', '참여율')),
        el('td', { 'data-label': '다른 과제 참여율(%)' }, inp('otherRate', '다른 과제 참여율')),
        el('td', { 'data-label': '구분' }, kind),
        el('td', { 'data-cost': idx, 'data-label': '인건비(천원)' }),
        el('td', { class: 'del' }, el('button', { type: 'button', class: 'icon', 'aria-label': `연구원 ${n} 삭제`, text: '✕', onclick: () => { S.people.splice(idx, 1); renderPeople(); update(); } })),
      ));
    });
  }
  $('addPerson').addEventListener('click', () => {
    if (S.people.length >= 50) return;
    S.people.push({ name: '', salary: '', months: 12, rate: '', otherRate: '', kind: 'existing' });
    renderPeople(); update();
    pBody.lastElementChild.querySelector('input').focus();
  });

  // ---------- 3. 비목 ----------
  const iBody = $('items').querySelector('tbody'), iFoot = $('items').querySelector('tfoot');
  let cells = {};
  function renderItems() {
    iBody.replaceChildren(); cells = {};
    const profit = RB.effectiveRules(S).profit;
    for (const it of [...RB.ITEMS.filter((x) => !(x.nonprofitOnly && profit)), { key: 'indirect', label: '간접비' }]) {
      const v = (S.items[it.key] ||= {});
      const auto = it.key === 'personnel' || it.key === 'indirect';
      const num = (side) => {
        if (auto || (side === 'inkind' && !it.inkind)) return el('td', { 'data-cell': `${it.key}.${side}`, class: side === 'inkind' && !it.inkind && !auto ? 'na' : '' });
        return el('td', {}, el('input', { value: groupDigits(v[side] ?? ''), inputmode: 'numeric', maxlength: 14, 'aria-label': `${it.label} ${side === 'cash' ? '현금' : '현물'}(천원)`,
          oninput: (e) => { v[side] = e.target.value; e.target.value = groupDigits(e.target.value); update(); } }));
      };
      const label = el('td', {}, it.label);
      if (auto) label.append(' ', el('span', { class: 'computed', text: it.key === 'personnel' ? '(2단계에서 계산)' : '(자동 계산)' }));
      iBody.append(el('tr', {}, label, num('cash'), num('inkind'), el('td', { 'data-cell': `${it.key}.total` }), el('td', { 'data-cell': `${it.key}.share` })));
    }
    iBody.querySelectorAll('[data-cell]').forEach((c) => { cells[c.dataset.cell] = c; });
  }

  // ---------- 계산·표시 ----------
  function update() {
    const r = RB.calcBudget(S);
    const f = r.funding;
    const kp = [['최소 총사업비', f.total], ['기관부담금(최소)', f.org]];
    if (r.rules.cashMinPct) kp.push(['그중 현금(최소)', f.cashMin], ['현물 가능(최대)', f.inkindMax]);
    $('funding').replaceChildren(...kp.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: `${fmt(v)}천원` }))));
    r.people.forEach((p, i) => { const c = pBody.querySelector(`[data-cost="${i}"]`); if (c) c.textContent = fmt(p.cost); });
    for (const row of r.rows) {
      for (const side of ['cash', 'inkind']) { const c = cells[`${row.key}.${side}`]; if (c) c.textContent = c.classList.contains('na') ? '—' : fmt(row[side]); }
      if (cells[`${row.key}.total`]) cells[`${row.key}.total`].textContent = fmt(row.total);
      if (cells[`${row.key}.share`]) cells[`${row.key}.share`].textContent = r.total.total ? `${((row.total / r.total.total) * 100).toFixed(1)}%` : '-';
    }
    iFoot.replaceChildren(el('tr', {}, el('td', { text: '합계' }), el('td', { text: fmt(r.total.cash) }), el('td', { text: fmt(r.total.inkind) }), el('td', { text: fmt(r.total.total) }), el('td', { text: r.total.total ? '100%' : '-' })));
    const remain = $('remain');
    if (f.gov) {
      const lack = f.total - r.total.total;
      const cashLack = f.gov + f.cashMin - r.total.cash;
      remain.textContent = lack > 0 ? `최소 총사업비까지 ${fmt(lack)}천원 더 편성하세요${cashLack > 0 ? `(그중 현금 ${fmt(cashLack)}천원 이상)` : ''}.` : '최소 총사업비를 충족했습니다.';
      remain.className = 'remain ' + (lack > 0 ? 'todo' : 'done');
    } else remain.textContent = '';
    $('checks').replaceChildren(...r.checks.map((c) => el('li', { class: c.level }, el('span', { text: c.msg }), c.basis ? el('small', { class: 'cite', text: c.basis }) : '')));
    save();
    return r;
  }

  // ---------- 5. 엑셀·저장 ----------
  $('print').addEventListener('click', () => window.print());
  $('reset').addEventListener('click', () => {
    if (!confirm('입력한 내용을 모두 지우고 새로 작성할까요? (저장한 안은 유지)')) return;
    S = blank(); save(); location.reload();
  });
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
        el('span', {}, el('strong', { text: sc.name }), ' ', el('span', { class: 'meta', text: `${r.rules.label} · 정부 ${fmt(r.funding.gov)} · 총 ${fmt(r.total.total)}천원 · ${sc.savedAt}` })),
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

  // ---------- 광고(설정 시에만) ----------
  const slots = CFG.adsenseSlots || {};
  if (CFG.adsenseClient && (slots.top || slots.bottom)) {
    const units = [];
    for (const [pos, slot] of Object.entries(slots)) {
      const box = $(`ad-${pos}`);
      if (!slot || !box) continue;
      box.hidden = false;
      box.append(el('ins', { class: 'adsbygoogle', style: 'display:block', 'data-ad-client': CFG.adsenseClient, 'data-ad-slot': slot, 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' }));
      units.push(slot);
    }
    const s = el('script', { async: true, src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CFG.adsenseClient)}`, crossorigin: 'anonymous' });
    s.addEventListener('load', () => { units.forEach(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* 광고 차단 등 */ } }); });
    document.head.append(s);
  }

  syncRuleInputs(); renderPeople(); renderItems(); renderScenarios(); update();
})();
