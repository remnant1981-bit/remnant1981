// 화면 처리. 계산은 logic.js(RB), 설정은 config.js(RB_CONFIG)
// 상태: 과제(project v2) = 연차 수 × 기관 목록. 화면 1~4단계는 '편집 중' 기관·연차 1개를 편집.
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
  const yl = (y) => `${y + 1}차년도`;

  // 기능 스위치(config.js features). 꺼진 기능은 숨김만 하고 저장 데이터는 유지
  const FEAT = Object.assign({ examples: true, project: false, scenarios: false, faq: false, steps: false, legalHeader: false, execution: false }, CFG.features || {});
  document.querySelectorAll('[data-feature]').forEach((e) => { if (!FEAT[e.dataset.feature]) e.hidden = true; });
  // 연차·공동기관 기능이 꺼져 있으면 첫 기관·1차년도만 편집·계산·내보내기
  const single = (p) => (FEAT.project ? p : { ...p, years: 1, insts: p.insts.slice(0, 1) });

  let S = RB.normalizeProject(store.get('rb.current', {}));
  let C = Object.assign({ i: 0, y: 0 }, store.get('rb.cur', {}));
  const clampCur = () => { if (!FEAT.project) { C.i = 0; C.y = 0; return; } C.i = Math.min(Math.max(0, C.i | 0), S.insts.length - 1); C.y = Math.min(Math.max(0, C.y | 0), S.years - 1); };
  clampCur();
  const I = () => S.insts[C.i];
  const Y = () => I().data[C.y];
  const save = () => { store.set('rb.current', S); store.set('rb.cur', C); };
  const replaceProject = (p) => { S = RB.normalizeProject(p); C = { i: 0, y: 0 }; save(); location.reload(); };

  $('basisLine').textContent = `적용 법령: ${RB.SOURCES.decreeT1} · ${RB.SOURCES.std} — 기준일 ${RB.BASIS_DATE}`;
  $('foot').textContent = `참고용 계산입니다. 공고문·운영요령이 우선합니다. 근거: ${RB.SOURCES.decreeT1}, ${RB.SOURCES.std}(기준일 ${RB.BASIS_DATE}).${CFG.contact ? ` 문의: ${CFG.contact}` : ''}`;
  if (FEAT.project) $('h-out-t').textContent = '총괄표·엑셀';

  // ---------- 예시(데모) ----------
  const hasInput = () => S.insts.some((inst) => inst.data.some((d) => RB.int(d.gov) || d.people.some((p) => p.name || p.salary) || Object.values(d.items).some((v) => v && (v.cash || v.inkind))));
  const isExample = () => String(S.title || '').startsWith('[예시]');
  document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => {
    const ex = RB.EXAMPLES[b.dataset.example];
    if (hasInput() && !isExample() && !confirm(`'${ex.label}'으로 바꿀까요? 지금 입력한 내용은 지워집니다. (필요하면 먼저 '현재 안 저장')`)) return;
    replaceProject(FEAT.project ? ex.state : single(RB.normalizeProject(ex.state)));
  }));
  if (isExample()) {
    const n = $('demoNote');
    n.hidden = false;
    n.append('예시 데이터로 체험 중입니다. 값을 바꿔 보며 점검 결과를 확인하고, 실제 작성은 ', el('button', { type: 'button', class: 'linkbtn', text: '새로 작성', onclick: () => replaceProject({}) }), '을 누르세요.');
  }

  // ---------- 0. 과제 구성 ----------
  const titleIn = $('title');
  titleIn.value = S.title;
  titleIn.addEventListener('input', () => { S.title = titleIn.value; save(); });
  const yearsSel = $('years');
  for (let n = 1; n <= RB.MAX_YEARS; n++) yearsSel.append(el('option', { value: n, text: `${n}년(${n}개 연차)` }));
  yearsSel.value = S.years;
  yearsSel.addEventListener('change', () => {
    S.years = Number(yearsSel.value);
    S = RB.normalizeProject(S); clampCur(); renderAll();
  });
  const instBody = $('insts').querySelector('tbody');
  const rulesetOptions = (selected) => [['기업(영리기관)', ['sme', 'midS', 'midL', 'large']], ['비영리기관', ['univ', 'nonprofit']], ['기타', ['custom']]]
    .map(([g, keys]) => el('optgroup', { label: g }, ...keys.map((k) => el('option', { value: k, text: RB.RULESETS[k].label, selected: k === selected }))));
  function renderInsts() {
    instBody.replaceChildren();
    S.insts.forEach((inst, i) => {
      instBody.append(el('tr', {},
        el('td', { 'data-label': '기관명' }, el('input', { value: inst.name, maxlength: 40, 'aria-label': `기관 ${i + 1} 이름`, oninput: (e) => { inst.name = e.target.value; renderTabs(); updateSummary(); save(); } })),
        el('td', { 'data-label': '역할' }, el('select', { 'aria-label': `기관 ${i + 1} 역할`, onchange: (e) => { inst.role = e.target.value; renderTabs(); updateSummary(); save(); } },
          ...Object.entries(RB.ROLES).map(([k, v]) => el('option', { value: k, text: v.replace('연구개발', ''), selected: inst.role === k })))),
        el('td', { 'data-label': '기관 유형' }, el('select', { 'aria-label': `기관 ${i + 1} 유형`, onchange: (e) => setRuleset(i, e.target.value) }, ...rulesetOptions(inst.ruleset))),
        el('td', { class: 'del' }, S.insts.length > 1 ? el('button', { type: 'button', class: 'icon', 'aria-label': `${inst.name} 삭제`, text: '✕', onclick: () => {
          if (!confirm(`'${inst.name}'과 이 기관의 모든 연차 편성을 삭제할까요?`)) return;
          S.insts.splice(i, 1); clampCur(); renderAll();
        } }) : ''),
      ));
    });
    $('addInst').disabled = S.insts.length >= RB.MAX_INSTS;
  }
  $('addInst').addEventListener('click', () => {
    if (S.insts.length >= RB.MAX_INSTS) return;
    S.insts.push(RB.newInst('joint', S.insts.filter((x) => x.role === 'joint').length + 1));
    S = RB.normalizeProject(S);
    C.i = S.insts.length - 1; C.y = 0;
    renderAll();
    instBody.lastElementChild.querySelector('input').select();
  });

  // ---------- 편집 중 탭 ----------
  function renderTabs(P) {
    P = P || RB.calcProject(S);
    const chip = (label, on, errs, onclick, aria) => el('button', { type: 'button', class: `chip${on ? ' on' : ''}${errs ? ' bad' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': aria, onclick }, label, errs ? el('span', { class: 'cnt', text: `✖${errs}` }) : '');
    $('instTabs').replaceChildren(...P.insts.map((it, i) => {
      const errs = it.years.reduce((a, r) => a + r.errors, 0);
      return chip(`${it.role === 'lead' ? '주관 · ' : ''}${it.name}`, i === C.i, errs, () => go(i, C.y), `${it.name} 편집${errs ? `, 오류 ${errs}건` : ''}`);
    }));
    $('yearTabs').replaceChildren(...Array.from({ length: S.years }, (_, y) => {
      const errs = P.insts[C.i].years[y].errors;
      return chip(yl(y), y === C.y, errs, () => go(C.i, y), `${yl(y)} 편집${errs ? `, 오류 ${errs}건` : ''}`);
    }));
    $('copyPrev').hidden = C.y === 0;
    $('editBar').hidden = !FEAT.project || (S.insts.length === 1 && S.years === 1);
    $('curLabel').textContent = !FEAT.project || (S.insts.length === 1 && S.years === 1) ? '' : `— ${I().name} · ${yl(C.y)}`;
  }
  function go(i, y) { C.i = i; C.y = y; clampCur(); renderAll(); }
  $('copyPrev').addEventListener('click', () => {
    if (C.y === 0) return;
    if (!confirm(`${yl(C.y - 1)}의 정부출연금·인건비·비목을 ${yl(C.y)}에 복사할까요? 현재 ${yl(C.y)} 입력은 바뀝니다.`)) return;
    I().data[C.y] = JSON.parse(JSON.stringify(I().data[C.y - 1]));
    renderAll();
  });

  // ---------- 1. 기관 유형·적용 기준 ----------
  const sel = $('ruleset');
  const RULE_INPUTS = ['govMaxPct', 'cashMinPct', 'indirectPct', 'allowanceMaxPct'];
  function setRuleset(i, value) {
    const inst = S.insts[i];
    const prevKey = inst.ruleset;
    inst.ruleset = value;
    if (RB.RULESETS[value].custom) { // 직접 입력 시작값 = 직전 법령 기준
      const eff = RB.effectiveRules({ ...inst, ruleset: prevKey });
      inst.govMaxPct = eff.govMaxPct; inst.cashMinPct = eff.cashMinPct; inst.indirectPct = eff.indirectPct; inst.allowanceMaxPct = eff.allowancePct;
    } else inst.indirectPct = '';
    renderAll();
  }
  function syncRuleInputs() {
    sel.replaceChildren(...rulesetOptions(I().ruleset));
    sel.value = I().ruleset;
    const rs = RB.RULESETS[I().ruleset];
    const eff = RB.effectiveRules(I());
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
    $('ruleSummary').textContent = rs.profit || custom
      ? `적용 기준: 정부지원 ≤ ${eff.govMaxPct}% · 기관부담 현금 ≥ ${eff.cashMinPct}% · 간접비 ${eff.indirectPct}%`
      : `적용 기준: 기관부담 의무 없음 · 간접비 ${eff.indirectPct}%`;
    if (custom) $('ruleBox').open = true;
    $('ruleMode').textContent = custom ? '공고문 기준 직접 입력' : '법령 기준 고정';
    $('ruleMode').classList.toggle('warn', custom);
    $('ruleHint').textContent = custom
      ? '공고문·운영요령에 적힌 비율을 입력하세요. 법령 기준과 다를 수 있으므로 공고문 해당 조항을 확인하세요.'
      : rs.profit
        ? `🔒 표시 값은 법령 기준으로 고정됩니다. 간접비율은 기관 간접비 고시비율 범위(최대 ${rs.indirectMax}%) 안에서 낮출 수 있습니다. 기관 유형은 모든 연차에 같이 적용됩니다.`
        : '🔒 비영리기관은 기관부담 의무가 없습니다. 간접비율은 기관 고시비율이 있으면 그 값으로 바꾸세요.';
  }
  sel.addEventListener('change', () => setRuleset(C.i, sel.value));
  for (const id of RULE_INPUTS) $(id).addEventListener('input', (e) => { if (!e.target.readOnly) { I()[id] = e.target.value; update(); } });
  $('indirectPct').addEventListener('blur', syncRuleInputs); // 상한 초과 입력 시 상한값으로 표시
  const govIn = $('gov');
  govIn.addEventListener('input', () => { Y().gov = govIn.value; govIn.value = groupDigits(govIn.value); update(); });

  // ---------- 2. 참여연구원 ----------
  const pBody = $('people').querySelector('tbody');
  function renderPeople() {
    pBody.replaceChildren();
    const people = Y().people;
    people.forEach((p, idx) => {
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
        el('td', { class: 'del' }, el('button', { type: 'button', class: 'icon', 'aria-label': `연구원 ${n} 삭제`, text: '✕', onclick: () => { people.splice(idx, 1); renderPeople(); update(); } })),
      ));
    });
  }
  $('addPerson').addEventListener('click', () => {
    const people = Y().people;
    if (people.length >= 50) return;
    people.push({ name: '', salary: '', months: 12, rate: '', otherRate: '', kind: RB.effectiveRules(I()).profit ? 'existing' : 'new' });
    renderPeople(); update();
    pBody.lastElementChild.querySelector('input').focus();
  });

  // ---------- 3. 비목 ----------
  const iBody = $('items').querySelector('tbody'), iFoot = $('items').querySelector('tfoot');
  let cells = {};
  function renderItems() {
    iBody.replaceChildren(); cells = {};
    const profit = RB.effectiveRules(I()).profit;
    const items = Y().items;
    for (const it of [...RB.ITEMS.filter((x) => !(x.nonprofitOnly && profit)), { key: 'indirect', label: '간접비' }]) {
      const v = (items[it.key] ||= {});
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
    const r = RB.calcBudget(RB.sheetState(S, C.i, C.y));
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
    // 오류·주의만 기본 표시, 통과·계산 내역은 접어 둠
    const li = (c) => el('li', { class: c.level }, el('span', { text: c.msg }), c.basis ? el('small', { class: 'cite', text: c.basis }) : '');
    const issues = r.checks.filter((c) => c.level === 'error' || c.level === 'warn');
    const passed = r.checks.filter((c) => c.level === 'ok' || c.level === 'info');
    const ready = !!f.gov && !!r.total.total;
    $('checks').replaceChildren(...(issues.length ? issues.map(li) : [li(ready ? { level: 'ok', msg: '오류 없음 — 법령 기준을 모두 충족합니다.' } : passed[0] || { level: 'info', msg: '' })]));
    $('passedBox').hidden = !ready;
    $('passedSum').textContent = `계산 내역·통과 항목 ${passed.length}건`;
    $('passed').replaceChildren(...passed.map(li));
    // 우측 편성 요약(실시간)
    const t = r.total, orgCash = Math.max(0, t.cash - f.gov), errs = r.checks.filter((c) => c.level === 'error').length;
    const kv = (k, v, cls) => el('div', { class: cls || '' }, el('dt', { text: k }), el('dd', { text: v }));
    $('live').replaceChildren(
      kv('총사업비', `${fmt(t.total)}천원`, 'big'),
      kv('최소 총사업비', `${fmt(f.total)}천원`),
      kv('정부지원', `${fmt(f.gov)}${t.total ? ` (${((f.gov / t.total) * 100).toFixed(1)}%)` : ''}`),
      kv('기관 현금', `${fmt(orgCash)}${t.total - f.gov > 0 ? ` (${((orgCash / (t.total - f.gov)) * 100).toFixed(1)}%)` : ''}`),
      kv('기관 현물', fmt(t.inkind)),
      kv('점검', !f.gov ? '입력 대기' : errs ? `오류 ${errs}건` : '통과', !f.gov ? '' : errs ? 'bad' : 'good'));
    const w = (v) => (t.total ? `${(v / t.total) * 100}%` : '0');
    $('meterGov').style.width = w(Math.min(f.gov, t.cash)); $('meterCash').style.width = w(orgCash); $('meterInk').style.width = w(t.inkind);
    $('liveCur').textContent = $('curLabel').textContent.replace(/^— /, '');
    updateSummary();
    save();
    return r;
  }

  // ---------- 5. 총괄표 ----------
  function updateSummary() {
    const P = RB.calcProject(single(S));
    renderTabs(P);
    const multi = S.years > 1;
    const head = el('tr', {}, el('th', { text: '기관' }), ...Array.from({ length: S.years }, (_, y) => el('th', { text: yl(y) })), ...(multi ? [el('th', { text: '합계' })] : []));
    const cell = (s, errs, onclick, label) => el('td', {}, el('button', { type: 'button', class: `sumcell${errs ? ' bad' : ''}`, onclick, 'aria-label': label },
      el('strong', { text: fmt(s.total) }), el('small', { text: `정부 ${fmt(s.gov)} · 현금 ${fmt(s.orgCash)} · 현물 ${fmt(s.inkind)}` }), errs ? el('span', { class: 'cnt', text: `✖ 오류 ${errs}` }) : ''));
    const plain = (s, strong) => el('td', {}, el(strong ? 'strong' : 'span', { text: fmt(s.total) }), el('small', { text: `정부 ${fmt(s.gov)}${s.total ? ` (${((s.gov / s.total) * 100).toFixed(1)}%)` : ''}` }));
    const rows = P.insts.map((it, i) => el('tr', {},
      el('th', { scope: 'row', text: `${it.role === 'lead' ? '주관 · ' : ''}${it.name}` }),
      ...it.years.map((r, y) => cell(r.sum, r.errors, () => { go(i, y); $('s1').scrollIntoView({ behavior: 'smooth' }); }, `${it.name} ${yl(y)} 편집`)),
      ...(multi ? [plain(it.total)] : [])));
    const foot = el('tr', { class: 'total' }, el('th', { scope: 'row', text: '합계' }), ...P.yearTotals.map((t) => plain(t, true)), ...(multi ? [plain(P.total, true)] : []));
    $('summary').replaceChildren(el('caption', { text: '단위: 천원 · 칸을 누르면 해당 기관·연차 편집' }), el('thead', {}, head), el('tbody', {}, ...rows), el('tfoot', {}, foot));
    $('projChecks').replaceChildren(...P.checks.map((c) => el('li', { class: c.level }, el('span', { text: c.msg }))));
  }

  function renderAll() {
    clampCur();
    renderInsts();
    yearsSel.value = S.years;
    syncRuleInputs();
    govIn.value = groupDigits(Y().gov);
    renderPeople(); renderItems(); update();
    if (C.mode === 'exec') renderExec();
  }

  // ---------- 엑셀·저장 ----------
  $('print').addEventListener('click', () => window.print());
  $('reset').addEventListener('click', () => {
    if (!confirm('입력한 내용을 모두 지우고 새로 작성할까요? (저장한 안은 유지)')) return;
    replaceProject({});
  });
  $('xlsx').addEventListener('click', () => {
    const bytes = RB.buildXlsx(single(S));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = el('a', { href: url, download: `${(S.title || '사업비편성표').replace(/[\\/:*?"<>|]/g, '_')}_${today()}.xlsx` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  const MAX_SCEN = 20;
  function renderScenarios() {
    const list = store.get('rb.scenarios', []);
    $('scenarios').replaceChildren(...list.map((sc, i) => {
      const P = RB.calcProject(sc.state);
      return el('li', {},
        el('span', {}, el('strong', { text: sc.name }), ' ', el('span', { class: 'meta', text: `기관 ${P.insts.length} · ${P.project.years}개 연차 · 정부 ${fmt(P.total.gov)} · 총 ${fmt(P.total.total)}천원 · ${sc.savedAt}` })),
        el('span', {},
          el('button', { type: 'button', class: 'btn ghost', text: '불러오기', onclick: () => { if (confirm(`'${sc.name}'을 불러올까요? 현재 입력은 바뀝니다.`)) replaceProject(sc.state); } }), ' ',
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

  // ---------- 집행 현황판(features.execution) ----------
  const X = () => { const d = Y(); d.exec = RB.normalizeExec(d.exec); return d.exec; };
  const projEnd = () => I().data.slice(0, S.years).map((d) => d.exec && d.exec.end).filter(RB.isYmd).sort().pop() || '';
  const ST = { ok: ['ok', '정상'], over: ['bad', '✖ 초과'], slow: ['warn', '⚠ 부진'], fast: ['warn', '⚠ 과속'] };
  let xKeys = '';
  function setMode(mode) {
    C.mode = FEAT.execution && mode === 'exec' ? 'exec' : 'plan';
    document.querySelectorAll('#modeBar [data-mode]').forEach((b) => { const on = b.dataset.mode === C.mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $('planView').hidden = C.mode === 'exec';
    $('execView').hidden = C.mode !== 'exec';
    ['s0', 'ad-top', 'ad-bottom'].forEach((id) => { const e = $(id); if (e) e.classList.toggle('mode-hide', C.mode === 'exec'); });
    if (C.mode === 'exec') renderExec();
    save();
  }
  document.querySelectorAll('#modeBar [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function renderExec() {
    const ex = X();
    $('xCur').textContent = S.insts.length === 1 && S.years === 1 ? '' : `— ${I().name} · ${yl(C.y)}`;
    for (const [id, k] of [['xStart', 'start'], ['xEnd', 'end'], ['xDue', 'cashDue']]) $(id).value = ex[k] || '';
    xKeys = '';
    renderExecGrid(); renderExecPaid(); updateExec();
  }
  for (const [id, k] of [['xStart', 'start'], ['xEnd', 'end'], ['xDue', 'cashDue']]) {
    $(id).addEventListener('change', (e) => { X()[k] = RB.isYmd(e.target.value) ? e.target.value : ''; renderExecGrid(); updateExec(); });
  }
  function renderExecGrid() {
    const ex = X(), E = RB.calcExecution(S, C.i, C.y, today(), projEnd());
    const months = E.months.length ? E.months : Array.from({ length: 12 }, (_, k) => `${k + 1}개월`);
    const plan = RB.calcBudget(RB.sheetState(S, C.i, C.y)).rows;
    const head = el('tr', {}, el('th', { text: '비목' }), ...months.map((m) => el('th', { text: m.length === 7 ? `${m.slice(2, 4)}.${m.slice(5)}` : m })), el('th', { text: '누계' }));
    const body = plan.map((r) => {
      const arr = (ex.monthly[r.key] ||= []);
      return el('tr', {}, el('td', { text: r.label }), ...Array.from({ length: 12 }, (_, k) => el('td', {}, el('input', { value: groupDigits(arr[k] ?? ''), inputmode: 'numeric', maxlength: 12, 'aria-label': `${r.label} ${months[k]} 집행액(천원)`,
        oninput: (e) => { arr[k] = e.target.value; e.target.value = groupDigits(e.target.value); updateExec(); } }))), el('td', { 'data-xsum': r.key }));
    });
    $('xGrid').replaceChildren(el('thead', {}, head), el('tbody', {}, ...body));
  }
  function renderExecPaid() {
    const ex = X();
    const rows = ex.paid.map((x, k) => el('tr', {},
      el('td', {}, el('input', { type: 'date', value: x.date || '', 'aria-label': `납부 ${k + 1} 날짜`, onchange: (e) => { x.date = e.target.value; updateExec(); } })),
      el('td', {}, el('input', { value: groupDigits(x.amount ?? ''), inputmode: 'numeric', maxlength: 12, 'aria-label': `납부 ${k + 1} 금액(천원)`, oninput: (e) => { x.amount = e.target.value; e.target.value = groupDigits(e.target.value); updateExec(); } })),
      el('td', { class: 'del' }, el('button', { type: 'button', class: 'icon', 'aria-label': `납부 ${k + 1} 삭제`, text: '✕', onclick: () => { ex.paid.splice(k, 1); renderExecPaid(); updateExec(); } }))));
    $('xPaid').replaceChildren(el('thead', {}, el('tr', {}, el('th', { text: '납부일' }), el('th', { text: '금액(천원)' }), el('th', {}, el('span', { class: 'sr', text: '삭제' })))), el('tbody', {}, ...rows), el('tfoot', {}, el('tr', {}, el('td', { text: '납부 누계 / 계획' }), el('td', { id: 'xPaidSum' }), el('td'))));
  }
  $('xAddPaid').addEventListener('click', () => { const ex = X(); if (ex.paid.length >= 100) return; ex.paid.push({ date: today(), amount: '' }); renderExecPaid(); updateExec(); $('xPaid').querySelector('tbody tr:last-child input:not([type=date])').focus(); });

  function updateExec() {
    const E = RB.calcExecution(S, C.i, C.y, today(), projEnd());
    const ex = X();
    // 현황표(비목 구성이 바뀔 때만 다시 그림 → 입력 포커스 유지)
    const keys = E.rows.map((r) => r.key).join(',');
    if (keys !== xKeys) {
      xKeys = keys;
      $('xRows').replaceChildren(
        el('thead', {}, el('tr', {}, ...['비목', '편성(현금)', '협약(현금)', '집행 누계', '잔액', `집행률 (│ 경과율)`, '상태'].map((t) => el('th', { text: t })))),
        el('tbody', {}, ...E.rows.map((r) => el('tr', { 'data-xrow': r.key },
          el('td', { text: r.label }), el('td', { 'data-c': 'plan' }),
          el('td', {}, el('input', { value: groupDigits(ex.agreed[r.key] ?? ''), placeholder: fmt(r.plan), inputmode: 'numeric', maxlength: 14, 'aria-label': `${r.label} 협약 금액(천원, 비우면 편성액)`,
            oninput: (e) => { ex.agreed[r.key] = e.target.value; e.target.value = groupDigits(e.target.value); updateExec(); } })),
          el('td', { 'data-c': 'spent' }), el('td', { 'data-c': 'remain' }), el('td', { 'data-c': 'rate' }), el('td', { 'data-c': 'st' })))),
        el('tfoot', {}, el('tr', {}, el('td', { text: '합계' }), el('td', { 'data-t': 'plan' }), el('td', { 'data-t': 'agreed' }), el('td', { 'data-t': 'spent' }), el('td', { 'data-t': 'remain' }), el('td', { 'data-t': 'rate' }), el('td'))));
    }
    for (const r of E.rows) {
      const tr = $('xRows').querySelector(`[data-xrow="${r.key}"]`); if (!tr) continue;
      const c = (k) => tr.querySelector(`[data-c="${k}"]`);
      c('plan').textContent = fmt(r.plan); c('spent').textContent = fmt(r.spent);
      c('remain').textContent = fmt(r.remain); c('remain').classList.toggle('neg', r.remain < 0);
      c('rate').replaceChildren(el('span', { class: 'xbar' }, el('span', { style: `width:${Math.min(r.rate, 100)}%` }), E.ready ? el('i', { style: `left:${E.elapsedPct}%` }) : ''), `${r.rate > 900 ? '—' : r.rate + '%'}`);
      const [cls, label] = ST[r.status];
      c('st').replaceChildren(el('span', { class: `st ${cls}`, text: label }));
    }
    const tf = (k, v) => { const e = $('xRows').querySelector(`[data-t="${k}"]`); if (e) e.textContent = v; };
    tf('plan', fmt(E.rows.reduce((a, r) => a + r.plan, 0))); tf('agreed', fmt(E.total.agreed)); tf('spent', fmt(E.total.spent)); tf('remain', fmt(E.total.remain)); tf('rate', `${E.total.rate}%`);
    $('xHint').textContent = `현물 ${fmt(E.inkind)}천원은 편성액 기준(집행 관리 대상 아님) · 협약 금액을 비우면 편성액 사용 · 부진·과속 기준: 경과율 ±${RB.LIMITS.execDeviationPct}%p`;
    for (const r of RB.calcBudget(RB.sheetState(S, C.i, C.y)).rows) {
      const e = $('xGrid').querySelector(`[data-xsum="${r.key}"]`);
      if (e) e.textContent = fmt((ex.monthly[r.key] || []).slice(0, 12).reduce((a, v) => a + RB.int(v), 0));
    }
    const kv = (k, v, cls) => el('div', { class: cls || '' }, el('dt', { text: k }), el('dd', { text: v }));
    $('xKpis').replaceChildren(
      kv('경과일', E.ready ? `${E.days.passed}일 / ${E.days.total}일` : '기간 입력 필요'),
      kv('경과율', E.ready ? `${E.elapsedPct}%` : '-'),
      kv('남은 기간', E.ready ? `${Math.max(0, E.days.total - E.days.passed)}일` : '-'),
      kv('협약 금액', Object.values(ex.agreed).some((v) => String(v ?? '') !== '') ? '일부 조정' : '편성값 사용'));
    const errs = E.checks.filter((c) => c.level === 'error').length, warns = E.checks.filter((c) => c.level === 'warn').length;
    $('xLive').replaceChildren(
      kv('총 집행률(현금)', `${E.total.rate}%`, 'big'), kv('경과율', E.ready ? `${E.elapsedPct}%` : '-'),
      kv('잔액', `${fmt(E.total.remain)}천원`), kv('집행 누계', `${fmt(E.total.spent)}천원`),
      kv('경고', errs || warns ? `초과·오류 ${errs} · 주의 ${warns}` : '없음', errs ? 'bad' : warns ? '' : 'good'));
    $('xMeter').style.width = `${Math.min(100, E.total.rate)}%`;
    $('xLegend').textContent = `집행률 ${E.total.rate}% · 경과율 ${E.ready ? E.elapsedPct + '%' : '-'}`;
    const order = { error: 0, warn: 1, info: 2, ok: 3 };
    $('xChecks').replaceChildren(...[...E.checks].sort((a, b) => order[a.level] - order[b.level]).map((c) => el('li', { class: c.level }, el('span', { text: c.msg }), c.basis ? el('small', { class: 'cite', text: c.basis }) : '')));
    $('xSched').replaceChildren(...(E.schedule.length ? E.schedule.map((s) => el('li', { class: s.done ? 'done' : '' }, el('span', { text: `${s.label} (${s.date})` }),
      el(s.dday < 0 || (!s.done && s.dday <= 30) ? 'b' : 'span', { text: s.done ? '완료' : s.dday >= 0 ? `D-${s.dday}` : `D+${-s.dday}` }))) : [el('li', {}, el('span', { text: '연차 기간을 입력하면 표시됩니다.' }))]));
    const ps = $('xPaidSum'); if (ps) ps.textContent = `${fmt(E.org.paid)} / ${fmt(E.org.plan)} (최소 ${fmt(E.org.min)})`;
    save();
  }
  $('xXlsx').addEventListener('click', () => {
    const bytes = RB.buildExecXlsx(S, C.i, C.y, today(), projEnd());
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = el('a', { href: url, download: `${(S.title || '집행현황').replace(/[\\/:*?"<>|]/g, '_')}_${yl(C.y)}_집행현황_${today()}.xlsx` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  // 백업: 과제 전체(편성+집행)를 JSON 파일로 저장·복원
  $('backupSave').addEventListener('click', () => {
    const data = JSON.stringify({ app: 'rnd-budget', v: 3, savedAt: new Date().toISOString(), project: S }, null, 1);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = el('a', { href: url, download: `사업비_백업_${(S.title || '과제').replace(/[\\/:*?"<>|]/g, '_')}_${today()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  $('backupLoad').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('size');
      const obj = JSON.parse(await file.text());
      if (!obj || obj.app !== 'rnd-budget' || !obj.project) throw new Error('format');
      const p = RB.normalizeProject(obj.project);
      if (!confirm(`백업(${String(obj.savedAt || '').slice(0, 10)}, ${p.title || '제목 없음'})을 불러올까요? 현재 입력은 바뀝니다.`)) return;
      S = p; C = { i: 0, y: 0, mode: 'exec' }; save(); location.reload();
    } catch { alert('백업 파일을 읽지 못했습니다. 이 도구에서 저장한 .json 파일인지 확인하세요.'); }
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

  renderAll(); renderScenarios();
  setMode(C.mode);
})();
