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
  // 금액 칸 공통 처리: 입력 중엔 자릿수 쉼표(커서 위치 유지), '3억'·'5천만'·'300000000원' 같은 표기는 칸을 벗어날 때 천원으로 환산
  function amountInput(e, set) {
    const t = e.target, raw = t.value.normalize('NFKC');
    if (/^[\d,\s]*$/.test(raw)) {
      const pos = t.selectionStart, before = raw.slice(0, pos ?? raw.length).replace(/\D/g, '').length;
      const g = groupDigits(raw); t.value = g;
      if (document.activeElement === t && pos != null) { let i = 0, d = 0; while (i < g.length && d < before) { if (/\d/.test(g[i])) d++; i++; } try { t.setSelectionRange(i, i); } catch { /* 일부 입력 형식은 미지원 */ } }
      set(g.replace(/\D/g, ''));
    } else set(String(RB.parseAmount(raw) || ''));
  }
  function amountBlur(e, set) {
    const raw = e.target.value.normalize('NFKC');
    if (/^[\d,\s]*$/.test(raw)) return;
    const n = RB.parseAmount(raw);
    e.target.value = n ? fmt(n) : ''; set(n ? String(n) : '');
  }
  const amt = (attrs, get, set, after) => el('input', { value: groupDigits(get() ?? ''), inputmode: 'numeric', maxlength: 18, autocomplete: 'off', ...attrs,
    oninput: (e) => { amountInput(e, set); after(); }, onblur: (e) => { amountBlur(e, (v) => { set(v); after(); }); } });
  const bindAmount = (input, set, after = () => {}) => {
    input.addEventListener('input', (e) => { amountInput(e, set); after(); });
    input.addEventListener('blur', (e) => amountBlur(e, (v) => { set(v); after(); }));
  };
  // 페이지 안 확인창(브라우저 기본 confirm·alert·prompt는 미리보기·임베드 환경에서 막힐 수 있음)
  const askDlg = $('askDlg');
  function ask(msg, opts = {}) {
    if (window.__rbAutoConfirm) return Promise.resolve(opts.input !== undefined ? (window.__rbAutoInput ?? opts.input) : true); // 자동 테스트용
    return new Promise((resolve) => {
      $('askMsg').textContent = msg;
      const inp = $('askInput');
      inp.hidden = opts.input === undefined; inp.value = opts.input ?? '';
      $('askCancel').hidden = !!opts.alert;
      $('askOk').textContent = opts.okText || '확인';
      const done = (v) => { askDlg.close ? askDlg.close() : askDlg.removeAttribute('open'); cleanup(); resolve(v); };
      const ok = () => done(opts.input !== undefined ? inp.value : true);
      const no = () => done(opts.input !== undefined ? null : false);
      const key = (e) => { if (e.key === 'Enter' && !inp.hidden) { e.preventDefault(); ok(); } };
      const cancelEv = (e) => { e.preventDefault(); no(); };
      const cleanup = () => { $('askOk').removeEventListener('click', ok); $('askCancel').removeEventListener('click', no); inp.removeEventListener('keydown', key); askDlg.removeEventListener('cancel', cancelEv); };
      $('askOk').addEventListener('click', ok); $('askCancel').addEventListener('click', no); inp.addEventListener('keydown', key); askDlg.addEventListener('cancel', cancelEv);
      if (askDlg.showModal) askDlg.showModal(); else askDlg.setAttribute('open', '');
      (inp.hidden ? $('askOk') : inp).focus();
    });
  }
  const notify = (msg) => ask(msg, { alert: true });

  // 방문 통계(config.js analytics.ga4에 측정 ID를 넣을 때만 동작). 금액·기관명·과제명·검색어 등 입력 내용은 보내지 않음
  const GA = CFG.analytics && /^G-[A-Z0-9]{4,}$/.test(CFG.analytics.ga4 || '') ? CFG.analytics.ga4 : '';
  if (GA) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    document.head.append(el('script', { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${GA}` }));
  }
  const tracked = new Set();
  /** 사용 이벤트 기록. once=true 면 방문당 1회 */
  const track = (name, params = {}, once = false) => {
    if (!GA) return;
    if (once) { if (tracked.has(name)) return; tracked.add(name); }
    try { window.gtag('event', name, params); } catch { /* 통계 실패는 무시 */ }
  };

  // 기능 스위치(config.js features). 꺼진 기능은 숨김만 하고 저장 데이터는 유지
  const FEAT = Object.assign({ examples: true, project: false, scenarios: false, faq: false, steps: false, legalHeader: false, execution: false, noticeImport: false, helper: false, details: false, ministry: false }, CFG.features || {});
  // 관리자 미리보기(admin.html): 이 브라우저에서만 기능 스위치를 바꿔 봄
  const PREVIEW = store.get('rb.preview', null);
  if (PREVIEW && PREVIEW.features && typeof PREVIEW.features === 'object') for (const [k, v] of Object.entries(PREVIEW.features)) if (k in FEAT && typeof v === 'boolean') FEAT[k] = v;
  document.querySelectorAll('[data-feature]').forEach((e) => { if (!FEAT[e.dataset.feature]) e.hidden = true; });
  // 연차·공동기관 기능이 꺼져 있으면 첫 기관·1차년도만 편집·계산·내보내기
  const single = (p) => (FEAT.project ? p : { ...p, years: 1, insts: p.insts.slice(0, 1) });

  let S = RB.normalizeProject(store.get('rb.current', {}));
  let C = Object.assign({ i: 0, y: 0 }, store.get('rb.cur', {}));
  const clampCur = () => { if (!FEAT.project) { C.i = 0; C.y = 0; return; } C.i = Math.min(Math.max(0, C.i | 0), S.insts.length - 1); C.y = Math.min(Math.max(0, C.y | 0), S.years - 1); };
  clampCur();
  const I = () => S.insts[C.i];
  const Y = () => I().data[C.y];
  let saveFailed = false;
  const save = () => {
    const ok = store.set('rb.current', S) && store.set('rb.cur', C);
    saveFailed = !ok;
    const st = $('saveStatus');
    if (st) {
      st.textContent = ok ? `✔ 이 브라우저에 자동 저장됨 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}` : '⚠ 자동 저장 실패(저장 공간·사생활 보호 모드) — 창을 닫기 전에 백업 저장하세요.';
      st.classList.toggle('bad', !ok);
    }
  };
  // 되돌리기: 한 번에 여러 값이 바뀌는 동작(예시·도우미·자동 고치기·삭제 등) 직전 상태를 보관
  let undoState = null;
  const mark = () => { undoState = { s: JSON.stringify(S), c: { ...C } }; };
  function offerUndo(msg) {
    const bar = $('undoBar'); if (!bar || !undoState) return;
    $('undoMsg').textContent = msg; bar.hidden = false;
    clearTimeout(bar._t); bar._t = setTimeout(() => { bar.hidden = true; }, 12000);
  }
  function undo() {
    const u = undoState; if (!u) return;
    undoState = null; $('undoBar').hidden = true;
    S = RB.normalizeProject(JSON.parse(u.s)); C = u.c; clampCur();
    titleIn.value = S.title; xKeys = ''; nameEdited = false;
    updateDemoNote(); renderAll(); setMode(C.mode);
  }
  // 새로고침 없이 교체(저장소를 못 쓰는 환경에서도 내용 유지)
  const replaceProject = (p, mode) => {
    const prevS = S, prevC = C;
    try {
      S = RB.normalizeProject(p); C = { i: 0, y: 0, mode: mode || C.mode || 'plan', dirty: false };
      titleIn.value = S.title; xKeys = ''; nameEdited = false;
      updateDemoNote(); renderAll(); setMode(C.mode); syncProjBox();
    } catch (e) {
      S = prevS; C = prevC; titleIn.value = S.title; xKeys = ''; updateDemoNote(); renderAll(); setMode(C.mode);
      throw e;
    }
    save();
    window.scrollTo(0, 0);
  };

  $('basisLine').textContent = `적용 법령: ${RB.SOURCES.decreeT1} · ${RB.SOURCES.std} — 기준일 ${RB.BASIS_DATE}`;
  $('foot').textContent = `${GA ? '이용 통계(구글 애널리틱스)로 방문·기능 사용 횟수를 집계합니다. 입력한 금액·기관명·과제명은 수집하지 않습니다. ' : ''}참고용 계산입니다. 공고문·운영요령이 우선합니다. 근거: ${RB.SOURCES.decreeT1}, ${RB.SOURCES.std}(기준일 ${RB.BASIS_DATE}).${CFG.contact ? ` 문의: ${CFG.contact}` : ''}`;
  if (FEAT.project) $('h-out-t').textContent = '총괄표·엑셀';

  // ---------- 예시(데모) ----------
  const hasInput = () => S.insts.some((inst) => inst.data.some((d) => RB.int(d.gov) || d.people.some((p) => p.name || p.salary) || Object.values(d.items).some((v) => v && (v.cash || v.inkind))));
  const isExample = () => String(S.title || '').startsWith('[예시]');
  document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', async () => {
    const ex = RB.EXAMPLES[b.dataset.example];
    const label = FEAT.project ? ex.label : ex.label.replace(/\(주관 중소 \+ 공동 대학, 2개 연차\)/, '(중소기업)');
    if (hasInput() && (!isExample() || C.dirty) && !(await ask(`'${label}'으로 바꿀까요? 지금 입력한 내용은 예시로 바뀝니다.${FEAT.scenarios ? " (필요하면 먼저 '현재 안 저장')" : ''}`))) return;
    const had = hasInput(); mark();
    replaceProject(FEAT.project ? ex.state : single(RB.normalizeProject(ex.state)));
    if (had) offerUndo('예시를 불러왔습니다.');
    track('rb_example', { example: b.dataset.example });
  }));
  function updateDemoNote() {
    const n = $('demoNote');
    n.hidden = !isExample();
    n.replaceChildren(...(isExample() ? ['예시 데이터로 체험 중입니다. 값을 바꿔 보며 점검 결과를 확인하고, 실제 작성은 ', el('button', { type: 'button', class: 'linkbtn', text: '새로 작성', onclick: () => $('reset').click() }), '을 누르세요.'] : []));
  }
  updateDemoNote();

  // ---------- 0. 과제 구성 ----------
  const titleIn = $('title');
  titleIn.value = S.title;
  titleIn.addEventListener('input', () => { S.title = titleIn.value; save(); updateDemoNote(); if (!nameEdited) $('xlsxName').value = defaultName(); });
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
        el('td', { 'data-label': '역할' }, el('select', { 'aria-label': `기관 ${i + 1} 역할`, onchange: (e) => {
          inst.role = e.target.value;
          // 기본 이름을 그대로 쓰고 있으면 역할에 맞춰 바꿈(직접 지은 이름은 유지)
          if (inst.role === 'joint' && inst.name === '주관기관') inst.name = `공동기관 ${S.insts.filter((x) => x !== inst && x.role === 'joint').length + 1}`;
          else if (inst.role === 'lead' && /^공동기관( \d+)?$/.test(inst.name)) inst.name = '주관기관';
          renderInsts(); renderTabs(); updateSummary(); save();
          instBody.children[i].querySelector('select').focus();
        } },
          ...Object.entries(RB.ROLES).map(([k, v]) => el('option', { value: k, text: v.replace('연구개발', ''), selected: inst.role === k })))),
        el('td', { 'data-label': '기관 유형' }, el('select', { 'aria-label': `기관 ${i + 1} 유형`, onchange: (e) => setRuleset(i, e.target.value) }, ...rulesetOptions(inst.ruleset))),
        el('td', { class: 'del' }, S.insts.length > 1 ? el('button', { type: 'button', class: 'icon', 'aria-label': `${inst.name} 삭제`, text: '✕', onclick: async () => {
          if (!(await ask(`'${inst.name}'과 이 기관의 모든 연차 편성을 삭제할까요?`))) return;
          mark(); S.insts.splice(i, 1); if (i < C.i) C.i--; clampCur(); renderAll(); offerUndo(`'${inst.name}'을 삭제했습니다.`);
        } }) : ''),
      ));
    });
    $('addInst').disabled = S.insts.length >= RB.MAX_INSTS;
    const lead = S.insts[0];
    $('projSum').textContent = `${S.years}년 · ${S.insts.length === 1 ? `${lead.name}(${lead.role === 'lead' ? '주관' : '공동'} · ${RB.RULESETS[lead.ruleset].label})` : `기관 ${S.insts.length}곳`}`;
  }
  // 과제 구성: 단독·1년 과제는 한 줄로 접어 두고, 다년차·공동 과제는 펼침
  const syncProjBox = () => { $('projBox').open = S.years > 1 || S.insts.length > 1; };
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
    $('yearTabs').replaceChildren(...Array.from({ length: P.project.years }, (_, y) => {
      const errs = P.insts[C.i].years[y].errors;
      return chip(yl(y), y === C.y, errs, () => go(C.i, y), `${yl(y)} 편집${errs ? `, 오류 ${errs}건` : ''}`);
    }));
    $('copyPrev').hidden = C.y === 0;
    $('editBar').hidden = !FEAT.project || (S.insts.length === 1 && S.years === 1);
    $('curLabel').textContent = !FEAT.project || (S.insts.length === 1 && S.years === 1) ? '' : `— ${I().name} · ${yl(C.y)}`;
  }
  function go(i, y) { C.i = i; C.y = y; clampCur(); renderAll(); }
  $('copyPrev').addEventListener('click', async () => {
    if (C.y === 0) return;
    if (!(await ask(`${yl(C.y - 1)}의 정부출연금·인건비·비목을 ${yl(C.y)}에 복사할까요? 현재 ${yl(C.y)} 입력은 바뀝니다.`))) return;
    const src = JSON.parse(JSON.stringify(I().data[C.y - 1])), cur = I().data[C.y];
    mark();
    cur.gov = src.gov; cur.people = src.people; cur.items = src.items; // 집행 기록(exec)은 유지
    renderAll(); offerUndo(`${yl(C.y - 1)} 내용을 복사했습니다.`);
  });

  // ---------- 1. 기관 유형·적용 기준 ----------
  const sel = $('ruleset');
  const RULE_INPUTS = ['govMaxPct', 'cashMinPct', 'indirectPct', 'allowanceMaxPct', 'outsourceMaxPct'];
  const RULE_EFF = { allowanceMaxPct: 'allowancePct', outsourceMaxPct: 'outsourcePct' };
  const rateMemo = new WeakMap(); // 기관별·유형별로 사용자가 넣은 비율 기억(유형을 오갔을 때 되살림)
  function setRuleset(i, value) {
    const inst = S.insts[i];
    const prevKey = inst.ruleset;
    if (prevKey === value) return;
    if (RULE_INPUTS.includes(document.activeElement && document.activeElement.id)) document.activeElement.blur(); // 유형 전환 시 비율 칸을 새 기준값으로 다시 표시
    const memo = rateMemo.get(inst) || {}; rateMemo.set(inst, memo);
    memo[prevKey] = Object.fromEntries(RULE_INPUTS.map((k) => [k, inst[k]]));
    inst.ruleset = value;
    if (RB.RULESETS[value].custom) {
      if (!RB.RULESETS[prevKey].custom) inst.lastLegal = prevKey;
      if (memo.custom) Object.assign(inst, memo.custom); // 전에 넣어 둔 공고문 비율 되살림
      else { // 직접 입력 시작값 = 직전 법령 기준
        const eff = RB.effectiveRules({ ...inst, ruleset: prevKey });
        inst.govMaxPct = eff.govMaxPct; inst.cashMinPct = eff.cashMinPct; inst.indirectPct = eff.indirectPct; inst.allowanceMaxPct = eff.allowancePct; inst.outsourceMaxPct = eff.outsourcePct;
      }
    } else inst.indirectPct = memo[value] ? memo[value].indirectPct ?? '' : '';
    renderAll();
  }
  function syncRuleInputs() {
    if (!sel.options.length) sel.replaceChildren(...rulesetOptions(I().ruleset)); // 다시 만들면 펼친 목록이 닫히므로 한 번만
    const minOn = ministryActive(I());
    sel.value = minOn ? I().lastLegal : I().ruleset;
    const rs = RB.RULESETS[I().ruleset];
    const eff = RB.effectiveRules(I());
    const custom = !!rs.custom;
    for (const id of RULE_INPUTS) {
      const i = $(id);
      const editable = custom || id === 'indirectPct';
      i.readOnly = !editable;
      i.classList.toggle('locked', !editable);
      i.title = editable ? '' : '법령 기준 고정값';
      const v = eff[RULE_EFF[id] || id];
      if (document.activeElement !== i || !editable) i.value = v; // 입력 중인 칸은 건드리지 않음(고정 칸은 항상 기준값)
    }
    document.querySelectorAll('[data-basis]').forEach((td) => { td.textContent = rs.basis[td.dataset.basis]; });
    $('ruleSummary').textContent = rs.profit || custom
      ? `적용 기준: 정부지원 ≤ ${eff.govMaxPct}% · 기관부담 현금 ≥ ${eff.cashMinPct}% · 간접비 ${eff.indirectPct}%`
      : `적용 기준: 기관부담 의무 없음 · 간접비 ${eff.indirectPct}%`;
    syncMinistry();
    if (custom) $('ruleBox').open = true;
    $('ruleMode').textContent = minOn ? `${RB.MINISTRIES[I().ministry].label} 기준` : custom ? '공고문 기준 직접 입력' : '법령 기준 고정';
    $('ruleMode').classList.toggle('warn', custom);
    $('allowanceBasis').textContent = custom ? '공고문 기준 입력값(법령: 수정인건비의 20% 이내, 사용 기준 제26조①)' : '사용 기준 제26조①: 수정인건비의 20% 이내';
    $('outsourceBasis').textContent = custom ? '공고문 기준 입력값(법령: (직접비 − 위탁)의 40% 이하, 사용 기준 제27조①)' : '사용 기준 제27조①: (직접비 − 위탁)의 40% 이하';
    $('ruleHint').textContent = custom
      ? (I().noticeSource ? `출처: ${I().noticeSource} — ` : '') + '공고문·운영요령에 적힌 비율을 입력하세요. 법령 기준과 다를 수 있으므로 공고문 해당 조항을 확인하세요.'
      : rs.profit
        ? `🔒 표시 값은 법령 기준으로 고정됩니다. 간접비율은 기관 간접비 고시비율 범위(최대 ${rs.indirectMax}%) 안에서 낮출 수 있습니다.${FEAT.project ? ' 기관 유형은 모든 연차에 같이 적용됩니다.' : ''}`
        : '🔒 비영리기관은 기관부담 의무가 없습니다. 간접비율은 기관 고시비율이 있으면 그 값으로 바꾸세요.';
  }
  // 부처 기준으로 비율이 바뀐 상태인지(기관 유형 칸에는 원래 유형을 계속 보여 줌)
  const ministryActive = (inst) => !!(inst.ministry && RB.RULESETS[inst.ruleset].custom && RB.MINISTRIES[inst.ministry] && inst.noticeSource === RB.MINISTRIES[inst.ministry].label && RB.ministryRates(inst.ministry, inst.lastLegal));
  sel.addEventListener('change', () => {
    const inst = I(), mk = inst.ministry, v = sel.value;
    if (mk && !RB.RULESETS[v].custom) { // 부처 기준은 유지하고 기관 유형만 바꿈
      inst.ruleset = v; inst.indirectPct = ''; inst.noticeSource = '';
      applyMinistry(mk);
    } else { delete inst.ministry; setRuleset(C.i, v); }
  });
  // 소관 부처·사업 유형(features.ministry): 원문으로 확인된 비율 차이만 적용, 나머지는 안내
  const minSel = $('ministry');
  minSel.replaceChildren(...Object.entries(RB.MINISTRIES).map(([k, m]) => el('option', { value: k, text: m.label })));
  function syncMinistry() {
    const key = I().ministry && RB.MINISTRIES[I().ministry] ? I().ministry : 'common', m = RB.MINISTRIES[key];
    minSel.value = key;
    $('ministryNote').hidden = !m.notes.length;
    $('ministryNote').replaceChildren(...m.notes.map((n) => el('li', { text: n })), ...(m.src ? [el('li', { class: 'cite', text: `근거: ${m.src} · 사업 공고가 우선합니다.` })] : []));
  }
  function applyMinistry(key) {
    const inst = I(), legal = RB.RULESETS[inst.ruleset].custom ? inst.lastLegal || 'sme' : inst.ruleset;
    const rates = RB.ministryRates(key, legal);
    if (key === 'common') delete inst.ministry; else inst.ministry = key;
    if (rates) { // 법령 기준에서 출발해 부처 기준 비율만 바꿈
      const base = RB.effectiveRules({ ruleset: legal });
      Object.assign(inst, { lastLegal: legal, ruleset: 'custom', govMaxPct: rates.govMaxPct, cashMinPct: rates.cashMinPct, indirectPct: base.indirectPct, allowanceMaxPct: base.allowancePct, outsourceMaxPct: base.outsourcePct, noticeSource: RB.MINISTRIES[key].label });
    } else if (RB.RULESETS[inst.ruleset].custom && Object.values(RB.MINISTRIES).some((x) => x.label === inst.noticeSource)) { // 부처 프리셋으로 바꿨던 비율은 법령 기준으로 되돌림
      inst.ruleset = legal; inst.indirectPct = ''; inst.noticeSource = '';
    }
    renderAll();
  }
  minSel.addEventListener('change', () => { mark(); applyMinistry(minSel.value); offerUndo(`적용 기준: ${RB.MINISTRIES[minSel.value].label}`); track('rb_ministry', { ministry: minSel.value }); });
  for (const id of RULE_INPUTS) {
    $(id).addEventListener('input', (e) => { if (!e.target.readOnly) { I()[id] = e.target.value; syncRuleInputs(); update(); } });
    $(id).addEventListener('blur', syncRuleInputs); // 범위를 벗어난 입력은 실제 적용값으로 표시
  }
  const govIn = $('gov');
  bindAmount(govIn, (v) => { Y().gov = v; }, () => update());

  // ---------- 2. 참여연구원 ----------
  const pBody = $('people').querySelector('tbody');
  function renderPeople() {
    pBody.replaceChildren();
    const people = Y().people;
    const profit = RB.effectiveRules(I()).profit;
    people.forEach((p, idx) => {
      p.kind ||= p.inkind ? 'existing' : 'new';
      const n = idx + 1;
      const inp = (key, label, mode = 'numeric', max = 12) => key === 'salary'
        ? amt({ 'aria-label': `연구원 ${n} ${label}` }, () => p.salary, (v) => { p.salary = v; }, update)
        : el('input', { value: p[key] ?? '', 'aria-label': `연구원 ${n} ${label}`, inputmode: mode, maxlength: max, oninput: (e) => { p[key] = e.target.value; update(); } });
      const kind = el('select', { 'aria-label': `연구원 ${n} 구분`, onchange: (e) => { p.kind = e.target.value; update(); } },
        ...Object.entries(RB.PERSON_KINDS).filter(([k]) => profit || k === 'new' || p.kind === k).map(([k, v]) => el('option', { value: k, text: profit ? v.label : k === 'new' ? '현금(정부출연금)' : v.label, selected: p.kind === k })));
      pBody.append(el('tr', {},
        el('td', { 'data-label': '성명' }, inp('name', '성명', 'text', 20)),
        el('td', { 'data-label': '연봉(천원)' }, inp('salary', '연봉(천원)')),
        el('td', { 'data-label': '참여개월' }, inp('months', '참여개월')),
        el('td', { 'data-label': '참여율(%)' }, inp('rate', '참여율')),
        el('td', { 'data-label': '다른 과제 참여율(%)' }, inp('otherRate', '다른 과제 참여율')),
        el('td', { 'data-label': '구분' }, kind),
        el('td', { 'data-cost': idx, 'data-label': '인건비(천원)' }),
        el('td', { class: 'del' }, el('button', { type: 'button', class: 'icon', 'aria-label': `연구원 ${n} 삭제`, text: '✕', onclick: () => { mark(); people.splice(idx, 1); renderPeople(); update(); offerUndo(`${p.name || `연구원 ${n}`}을(를) 삭제했습니다.`); $('addPerson').focus(); } })),
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
      const defs = FEAT.details ? RB.SUBITEMS[it.key] : null; // 세부 비목(세목) 입력 대상
      const sub = !!defs && RB.hasSub(it.key, v);
      const num = (side) => {
        if (sub) return el('td', { 'data-cell': `${it.key}.${side}`, class: 'subsum' }); // 세부 내역 합계(자동)
        if (auto || (side === 'inkind' && !it.inkind)) return el('td', { 'data-cell': `${it.key}.${side}`, class: side === 'inkind' && !it.inkind && !auto ? 'na' : '' });
        return el('td', {}, amt({ 'aria-label': `${it.label} ${side === 'cash' ? '현금' : '현물'}(천원)` }, () => v[side], (x) => { v[side] = x; }, update));
      };
      const label = el('td', {}, it.label);
      if (FEAT.helper && RB.ITEM_HELP[it.key]) {
        const helpRow = el('tr', { class: 'help-row', hidden: true }, el('td', { colspan: '5', text: RB.ITEM_HELP[it.key] }));
        label.append(' ', el('button', { type: 'button', class: 'info', 'aria-label': `${it.label} 설명`, 'aria-expanded': 'false', text: 'ⓘ', onclick: (e) => { helpRow.hidden = !helpRow.hidden; e.currentTarget.setAttribute('aria-expanded', String(!helpRow.hidden)); } }));
        label._help = helpRow;
      }
      if (auto) label.append(' ', el('span', { class: 'computed', text: it.key === 'personnel' ? '(2단계에서 계산)' : '(자동 계산)' }));
      if (defs) label.append(' ', el('button', { type: 'button', class: `subbtn${sub ? ' on' : ''}`, 'data-subbtn': it.key, 'aria-label': `${it.label} 세부 내역 ${sub ? `${v.sub.length}건` : '입력'}`, text: sub ? `세부 ${v.sub.length}` : '＋ 세부',
        onclick: () => { if (sub) { iBody.querySelector(`[data-subrow="${it.key}"] select`).focus(); return; } openSub(it, v); } }));
      if (sub) label.append(' ', el('span', { class: 'computed', text: '(세부 합계)' }));
      iBody.append(el('tr', { class: sub ? 'has-sub' : '' }, label, num('cash'), num('inkind'), el('td', { 'data-cell': `${it.key}.total` }), el('td', { 'data-cell': `${it.key}.share` })));
      if (label._help) iBody.append(label._help);
      if (sub) renderSubRows(it, v, defs);
    }
    iBody.querySelectorAll('[data-cell]').forEach((c) => { cells[c.dataset.cell] = c; });
  }

  // 세부 비목(features.details): 비목 아래에 세목 행을 펼쳐 입력. 세부가 있으면 비목 금액은 그 합계
  const mqNarrow = window.matchMedia('(max-width:639px)');
  mqNarrow.addEventListener('change', () => { if (FEAT.details) { renderItems(); update(); } });
  const rerenderItems = (focusSel) => { renderItems(); update(); if (focusSel) { const e = iBody.querySelector(focusSel); if (e) e.focus(); } };
  function openSub(it, v) {
    mark(); track('rb_details_open', { item: it.key });
    const defs = RB.SUBITEMS[it.key];
    // 이미 넣어 둔 합계는 첫 세목 행으로 옮겨 금액이 바뀌지 않게 함
    v.sub = [{ t: it.key === 'activity' ? 'etc' : defs[0].k, name: '', cash: v.cash || '', inkind: it.inkind ? v.inkind || '' : '' }];
    rerenderItems(`[data-subrow="${it.key}"] select`);
  }
  function renderSubRows(it, v, defs) {
    v.sub.forEach((r, k) => {
      const t = RB.subType(it.key, r.t), n = k + 1;
      const tot = el('td', { class: 'subtot', text: fmt(RB.int(r.cash) + (t && t.inkind ? RB.int(r.inkind) : 0)) });
      const after = () => { tot.textContent = fmt(RB.int(r.cash) + (t && t.inkind ? RB.int(r.inkind) : 0)); update(); };
      const selEl = el('select', { 'aria-label': `${it.label} 세목 ${n}`, onchange: (e) => { r.t = e.target.value; if (!(RB.subType(it.key, r.t) || {}).inkind) r.inkind = ''; renderItems(); update(); iBody.querySelectorAll(`[data-subrow="${it.key}"]`)[k].querySelector('select').focus(); } },
        ...(t ? [] : [el('option', { value: '', text: '세목 선택', selected: true })]), ...defs.map((d) => el('option', { value: d.k, text: d.label, selected: d.k === r.t })));
      const nameEl = el('input', { value: r.name || '', maxlength: 40, placeholder: t && t.unit ? '장비명(건별로 입력)' : '내용(선택)', 'aria-label': `${it.label} 세목 ${n} 내용`, oninput: (e) => { r.name = e.target.value; update(); } });
      const cashEl = amt({ placeholder: '현금', 'aria-label': `${it.label} 세목 ${n} 현금(천원)` }, () => r.cash, (x) => { r.cash = x; }, after);
      const inkEl = t && t.inkind ? amt({ placeholder: '현물', 'aria-label': `${it.label} 세목 ${n} 현물(천원)` }, () => r.inkind, (x) => { r.inkind = x; }, after) : null;
      const delEl = el('button', { type: 'button', class: 'icon', 'aria-label': `${it.label} 세목 ${n} 삭제`, text: '✕', onclick: () => {
        mark(); v.sub.splice(k, 1);
        if (!v.sub.length) { delete v.sub; v.cash = ''; v.inkind = ''; }
        rerenderItems(`[data-subbtn="${it.key}"]`); offerUndo('세목 행을 삭제했습니다.');
      } });
      if (mqNarrow.matches) { // 좁은 화면: 한 칸에 세로로 배치
        iBody.append(el('tr', { class: 'sub-row narrow', 'data-subrow': it.key }, el('td', { colspan: '5' }, el('div', { class: 'sub-card' }, selEl, delEl, nameEl,
          el('div', { class: 'sub-amts' }, cashEl, inkEl || el('span', { class: 'na', text: '현물 불가' }))))));
      } else {
        iBody.append(el('tr', { class: 'sub-row', 'data-subrow': it.key },
          el('td', {}, el('span', { class: 'sub-in' }, selEl, nameEl)), el('td', {}, cashEl), inkEl ? el('td', {}, inkEl) : el('td', { class: 'na', text: '—' }), tot, el('td', { class: 'del' }, delEl)));
      }
    });
    iBody.append(el('tr', { class: 'sub-add', 'data-subadd': it.key }, el('td', { colspan: '5' },
      el('button', { type: 'button', class: 'btn ghost sm', text: '＋ 세목 추가', disabled: v.sub.length >= RB.MAX_SUB, onclick: () => {
        v.sub.push({ t: '', name: '', cash: '', inkind: '' });
        rerenderItems(`[data-subadd="${it.key}"]`); const rows = iBody.querySelectorAll(`[data-subrow="${it.key}"]`); rows[rows.length - 1].querySelector('select').focus();
      } }), ' ',
      el('button', { type: 'button', class: 'linkbtn sub-close', text: '세부 없이 합계만 입력', onclick: () => {
        mark();
        const a = RB.itemAmounts(it.key, v, it.inkind);
        v.cash = a.cash ? String(a.cash) : ''; v.inkind = it.inkind && a.inkind ? String(a.inkind) : ''; delete v.sub;
        rerenderItems(`[data-subbtn="${it.key}"]`); offerUndo(`${it.label} 세부 내역을 합계로 바꿨습니다.`);
      } }))));
  }

  // ---------- 계산·표시 ----------
  function update() {
    const r = RB.calcBudget(RB.sheetState(S, C.i, C.y));
    const f = r.funding;
    const kp = [['최소 총사업비', f.total], ['기관부담금(최소)', f.org]];
    if (r.rules.cashMinPct) kp.push(['그중 현금(최소)', f.cashMin], ['현물로 낼 수 있는 최대', f.inkindMax]);
    $('govWon').textContent = f.gov ? `= ${RB.wonText(f.gov)}` : '천원 단위 · ‘3억’처럼 써도 됩니다';
    $('funding').hidden = !f.gov; // 입력 전에는 0만 보이므로 숨김
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
      remain.textContent = lack > 0 ? `최소 총사업비까지 ${fmt(lack)}천원 더 편성하세요${cashLack > 0 ? `(그중 현금 ${fmt(cashLack)}천원 이상)` : ''}.`
        : cashLack > 0 ? `총사업비는 충족했지만 현금이 ${fmt(cashLack)}천원 부족합니다(현물을 줄이고 현금 비목을 늘리세요).` : '최소 총사업비를 충족했습니다.';
      remain.className = 'remain ' + (lack > 0 || cashLack > 0 ? 'todo' : 'done');
    } else remain.textContent = '';
    // 오류·주의만 기본 표시, 통과·계산 내역은 접어 둠
    const fixes = FEAT.helper ? RB.suggestFixes(RB.sheetState(S, C.i, C.y)) : [];
    const fixFor = (c) => fixes.filter((x) => x.code === c.code && (x.ref === undefined || x.ref === c.ref));
    const fixBtn = (x) => el('button', { type: 'button', class: 'btn sm fix', text: `🛠 ${x.label}`, onclick: () => {
      mark();
      const d = Y(); const n = RB.applyFix({ gov: d.gov, people: d.people, items: d.items }, x);
      d.gov = n.gov ?? d.gov; d.people = n.people; d.items = n.items; govIn.value = groupDigits(d.gov); renderPeople(); renderItems(); update();
      offerUndo(`고쳤습니다: ${x.label}`);
      track('rb_fix', { code: x.code });
    } });
    const nErr = r.checks.filter((c) => c.level === 'error').length;
    if (f.gov) track('rb_first_input', {}, true); // 활성화: 정부출연금 입력
    if (f.gov && r.total.total && !nErr) track('rb_budget_ready', { ruleset: I().ruleset }, true); // 오류 없는 편성 완성
    $('fixAll').hidden = !(FEAT.helper && nErr && fixes.length);
    $('fixAll').textContent = `🛠 오류 ${nErr}건 한 번에 고치기`;
    const li = (c) => el('li', { class: c.level }, el('span', { text: c.msg }), c.basis ? el('small', { class: 'cite', text: c.basis }) : '', ...(c.code ? fixFor(c).map(fixBtn) : []));
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
    const blank = !f.gov && !t.total; // 처음 화면: 숫자 0 대신 작성 순서 안내
    $('liveStart').hidden = !blank; $('live').hidden = blank; $('liveMeter').hidden = blank;
    $('live').replaceChildren(
      kv('총사업비', t.total ? `${fmt(t.total)}천원` : '편성 전', 'big'),
      ...(t.total ? [kv('', RB.wonText(t.total), 'won')] : []),
      kv('최소 총사업비', `${fmt(f.total)}천원`),
      kv('정부지원', `${fmt(f.gov)}${t.total ? ` (${((f.gov / t.total) * 100).toFixed(1)}%)` : ''}`),
      kv('기관 현금', `${fmt(orgCash)}${t.total - f.gov > 0 ? ` (${((orgCash / (t.total - f.gov)) * 100).toFixed(1)}%)` : ''}`),
      kv('기관 현물', fmt(t.inkind)),
      kv('점검', !ready ? '입력 대기' : errs ? `오류 ${errs}건` : '통과', !ready ? '' : errs ? 'bad' : 'good'));
    const mb = $('mBar'); if (mb) { mb.querySelector('b').textContent = t.total ? `${fmt(t.total)}천원` : '편성 전'; const ms = mb.querySelector('span'); ms.textContent = !ready ? '입력 대기' : errs ? `오류 ${errs}건 보기` : '점검 통과'; ms.className = !ready ? '' : errs ? 'bad' : 'good'; }
    const w = (v) => (t.total ? `${(v / t.total) * 100}%` : '0');
    $('meterGov').style.width = w(Math.min(f.gov, t.cash)); $('meterCash').style.width = w(orgCash); $('meterInk').style.width = w(t.inkind);
    $('liveCur').textContent = $('curLabel').textContent.replace(/^— /, '');
    updateSummary();
    updateDownload(r);
    save();
    return r;
  }

  // ---------- 5. 총괄표 ----------
  function updateSummary() {
    const P = RB.calcProject(single(S));
    renderTabs(P);
    const multi = P.project.years > 1;
    const head = el('tr', {}, el('th', { text: '기관' }), ...Array.from({ length: P.project.years }, (_, y) => el('th', { text: yl(y) })), ...(multi ? [el('th', { text: '합계' })] : []));
    const cell = (s, errs, onclick, label) => el('td', {}, el('button', { type: 'button', class: `sumcell${errs ? ' bad' : ''}`, onclick, 'aria-label': label },
      el('strong', { text: fmt(s.total) }), el('small', {}, ...[`정부 ${fmt(s.gov)}`, `현금 ${fmt(s.orgCash)}`, `현물 ${fmt(s.inkind)}`].map((t) => el('span', { text: t }))), errs ? el('span', { class: 'cnt', text: `✖ 오류 ${errs}` }) : ''));
    const plain = (s, strong) => el('td', {}, el(strong ? 'strong' : 'span', { text: fmt(s.total) }), el('small', { text: `정부 ${fmt(s.gov)}${s.total ? ` (${((s.gov / s.total) * 100).toFixed(1)}%)` : ''}` }));
    const rows = P.insts.map((it, i) => el('tr', {},
      el('th', { scope: 'row', text: `${it.role === 'lead' ? '주관 · ' : ''}${it.name}` }),
      ...it.years.map((r, y) => cell(r.sum, r.errors, () => { go(i, y); $('s1').scrollIntoView({ behavior: 'smooth' }); }, `${it.name} ${yl(y)} 편집`)),
      ...(multi ? [plain(it.total)] : [])));
    const foot = el('tr', { class: 'total' }, el('th', { scope: 'row', text: '합계' }), ...P.yearTotals.map((t) => plain(t, true)), ...(multi ? [plain(P.total, true)] : []));
    $('summary').replaceChildren(el('caption', { text: '단위: 천원 · 칸을 누르면 해당 기관·연차 편집' }), el('thead', {}, head), el('tbody', {}, ...rows), el('tfoot', {}, foot));
    const solo = P.project.years === 1 && P.insts.length === 1; // 단독·1년 과제는 편성 요약과 같은 내용이라 총괄표 생략
    $('summary').parentElement.hidden = solo;
    if (FEAT.project) $('h-out-t').textContent = solo ? '엑셀 편성표' : '총괄표·엑셀';
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
  $('print').addEventListener('click', () => { track('rb_print'); window.print(); });
  $('reset').addEventListener('click', async () => {
    const hasExec = S.insts.some((x) => x.data.some((d) => d.exec && (d.exec.start || (d.exec.paid || []).length || Object.values(d.exec.monthly || {}).some((a) => (a || []).some((v) => RB.int(v))))));
    if (hasInput() && !(await ask(`입력한 내용을 모두 지우고 새로 작성할까요?${hasExec ? ' 집행 기록도 함께 지워지니 필요하면 먼저 백업 저장하세요.' : ''}${FEAT.scenarios ? ' (저장한 안은 유지)' : ''}`))) return;
    const had = hasInput(); mark();
    replaceProject({}, 'plan');
    if (had) offerUndo('새로 작성을 시작했습니다.');
  });
  $('fixAll').addEventListener('click', () => {
    const d = Y(); mark();
    const res = RB.autoFix({ ...RB.sheetState(S, C.i, C.y) });
    d.people = res.sheet.people; d.items = res.sheet.items;
    renderPeople(); renderItems(); update();
    offerUndo(res.remaining ? `${res.applied.length}건 고쳤고 ${res.remaining}건은 직접 확인이 필요합니다.` : `오류를 모두 고쳤습니다(${res.applied.length}단계). 바뀐 금액을 확인하세요.`);
    $('s3').scrollIntoView({ behavior: 'smooth' });
    track('rb_fix_all', { applied: res.applied.length, remaining: res.remaining });
  });
  // ---------- 엑셀 다운로드 카드 ----------
  const safeName = (v) => String(v || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '').trim().slice(0, 80);
  const defaultName = () => `${safeName(S.title) || '사업비편성표'}_${today()}`;
  let nameEdited = false;
  $('xlsxName').addEventListener('input', () => { nameEdited = true; });
  function toast(box, msg) {
    box.textContent = msg; box.hidden = false;
    clearTimeout(box._t); box._t = setTimeout(() => { box.hidden = true; }, 6000);
  }
  function updateDownload(r) {
    if (!nameEdited) $('xlsxName').value = defaultName();
    const P = single(S);
    const anySub = P.insts.some((x) => x.data.slice(0, P.years).some((d) => Object.keys(RB.SUBITEMS).some((k) => RB.hasSub(k, (d.items || {})[k]))));
    const sheets = ['총괄표', ...P.insts.map((x, i) => `${i + 1}.${x.name}`), '인건비 명세', '적용 기준', ...(anySub ? ['세부 내역'] : []), '점검 결과'];
    $('dlSheets').replaceChildren(...sheets.map((n) => el('li', { text: n })));
    const hasGov = !!RB.int(Y().gov), ready = hasGov && r.total.total > 0;
    const P2 = RB.calcProject(P);
    const errs = P2.insts.reduce((a, it) => a + it.years.reduce((b, y) => b + y.errors, 0), 0);
    const st = $('dlStatus');
    st.className = 'dl-status ' + (!ready ? 'wait' : errs || P2.empty.length ? 'warn' : 'ok');
    st.replaceChildren(!hasGov ? '정부출연금을 입력하면 다운로드할 수 있습니다.' : !ready ? '인건비·비목을 편성하면 다운로드할 수 있습니다.'
      : errs ? el('span', {}, `⚠ 점검 오류 ${errs}건 — 다운로드는 되지만 먼저 고치는 것을 권장합니다. `, el('a', { href: '#s4', text: '오류 보기' }))
        : P2.empty.length ? `⚠ 미편성 ${P2.empty.length}곳(${P2.empty.slice(0, 2).join(', ')}${P2.empty.length > 2 ? ' 등' : ''}) — 다운로드는 되지만 빈 연차가 엑셀에 0으로 들어갑니다.`
        : '✔ 점검 통과 — 합계·비율은 엑셀 수식으로 들어가 계획서에 맞춰 바로 고칠 수 있습니다.');
    $('xlsx').disabled = !ready;
  }
  $('xlsx').addEventListener('click', () => {
    const name = `${safeName($('xlsxName').value) || defaultName()}.xlsx`;
    const bytes = RB.buildXlsx(single(S), { savedAt: new Date().toISOString() });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    { const Pd = RB.calcProject(single(S)); track('rb_xlsx_download', { insts: Pd.insts.length, years: Pd.project.years, errors: Pd.insts.reduce((a, it) => a + it.years.reduce((b, y) => b + y.errors, 0), 0), ruleset: S.insts[0].ruleset }); }
    toast($('dlToast'), `✔ ‘${name}’ 다운로드됨 — 엑셀에서 열면 합계가 자동 계산됩니다. 이 파일을 ‘불러오기’에 올리면 이어서 작업할 수 있습니다.`);
  });
  const MAX_SCEN = 20;
  function renderScenarios() {
    const list = store.get('rb.scenarios', []);
    $('scenarios').replaceChildren(...list.map((sc, i) => {
      const P = RB.calcProject(sc.state);
      return el('li', {},
        el('span', {}, el('strong', { text: sc.name }), ' ', el('span', { class: 'meta', text: `기관 ${P.insts.length} · ${P.project.years}개 연차 · 정부 ${fmt(P.total.gov)} · 총 ${fmt(P.total.total)}천원 · ${sc.savedAt}` })),
        el('span', {},
          el('button', { type: 'button', class: 'btn ghost', text: '불러오기', onclick: async () => { if (await ask(`'${sc.name}'을 불러올까요? 현재 입력은 바뀝니다.`)) { mark(); replaceProject(sc.state); offerUndo(`'${sc.name}'을 불러왔습니다.`); } } }), ' ',
          el('button', { type: 'button', class: 'icon', 'aria-label': `${sc.name} 삭제`, text: '✕', onclick: () => { list.splice(i, 1); store.set('rb.scenarios', list); renderScenarios(); } })));
    }));
  }
  $('saveScenario').addEventListener('click', async () => {
    const list = store.get('rb.scenarios', []);
    if (list.length >= MAX_SCEN) { await notify(`최대 ${MAX_SCEN}개까지 저장할 수 있습니다. 기존 안을 삭제하세요.`); return; }
    const name = ((await ask('저장할 이름을 입력하세요.', { input: S.title || `안 ${list.length + 1}` })) || '').trim().slice(0, 40);
    if (!name) return;
    list.unshift({ name, savedAt: today(), state: JSON.parse(JSON.stringify(S)) });
    if (!store.set('rb.scenarios', list)) await notify('브라우저 저장 공간에 저장하지 못했습니다.');
    renderScenarios();
  });

  // ---------- 집행 현황판(features.execution) ----------
  const X = () => { const d = Y(); if (!d.exec || !Array.isArray(d.exec.paid) || !d.exec.monthly || !d.exec.agreed) d.exec = RB.normalizeExec(d.exec); return d.exec; };
  const projEnd = () => I().data.slice(0, S.years).map((d) => d.exec && d.exec.end).filter(RB.isYmd).sort().pop() || '';
  const ST = { ok: ['ok', '정상'], over: ['bad', '✖ 초과'], slow: ['warn', '⚠ 부진'], fast: ['warn', '⚠ 과속'] };
  let xKeys = '';
  function setMode(mode) {
    C.mode = FEAT.execution && mode === 'exec' ? 'exec' : 'plan';
    document.querySelectorAll('#modeBar [data-mode]').forEach((b) => { const on = b.dataset.mode === C.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('planView').hidden = C.mode === 'exec';
    $('execView').hidden = C.mode !== 'exec';
    ['s0', 'ad-top', 'ad-bottom'].forEach((id) => { const e = $(id); if (e) e.classList.toggle('mode-hide', C.mode === 'exec'); });
    if (C.mode === 'exec') { renderExec(); track('rb_exec_view', {}, true); }
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
    $(id).addEventListener('change', async (e) => {
      const ex = X(), val = RB.isYmd(e.target.value) ? e.target.value : '';
      if (k === 'start' && RB.isYmd(ex.start) && val && val.slice(0, 7) !== ex.start.slice(0, 7)) { // 입력해 둔 월별 금액을 달력 월에 맞춰 이동
        const sh = RB.shiftMonthly(ex.monthly, ex.start, val);
        if (sh.dropped && !(await ask(`시작일을 바꾸면 새 기간(12개월) 밖의 집행액 ${fmt(sh.dropped)}천원이 지워집니다. 계속할까요?`))) { e.target.value = ex.start; return; }
        mark(); ex.monthly = sh.monthly; ex.start = val; renderExecGrid(); updateExec();
        offerUndo('시작일에 맞춰 월별 집행액을 옮겼습니다.'); return;
      }
      ex[k] = val; renderExecGrid(); updateExec();
    });
  }
  function renderExecGrid() {
    const ex = X(), E = RB.calcExecution(S, C.i, C.y, today(), projEnd());
    const months = E.months.length ? E.months : Array.from({ length: 12 }, (_, k) => `${k + 1}개월`);
    const plan = RB.calcBudget(RB.sheetState(S, C.i, C.y)).rows;
    const lastUsed = Math.max(0, ...Object.values(ex.monthly).map((a) => (Array.isArray(a) ? a : []).slice(0, 12).reduce((mx, v, k) => (RB.int(v) ? k + 1 : mx), 0)));
    const nM = Math.max(E.nMonths || 12, lastUsed); // 연차 기간만큼만 표시(기간 밖에 입력값이 있으면 그 달까지)
    months.length = nM;
    const head = el('tr', {}, el('th', { text: '비목' }), ...months.map((m) => el('th', { text: m.length === 7 ? `${m.slice(2, 4)}.${m.slice(5)}` : m })), el('th', { text: '누계' }));
    const body = plan.map((r) => {
      const arr = (ex.monthly[r.key] ||= []);
      return el('tr', {}, el('td', { text: r.label }), ...Array.from({ length: nM }, (_, k) => el('td', {}, amt({ 'aria-label': `${r.label} ${months[k]} 집행액(천원)` }, () => arr[k], (v) => { arr[k] = v; }, updateExec))), el('td', { 'data-xsum': r.key }));
    });
    $('xGrid').replaceChildren(el('thead', {}, head), el('tbody', {}, ...body));
  }
  function renderExecPaid() {
    const ex = X();
    const rows = ex.paid.map((x, k) => el('tr', {},
      el('td', {}, el('input', { type: 'date', value: x.date || '', 'aria-label': `납부 ${k + 1} 날짜`, onchange: (e) => { x.date = e.target.value; updateExec(); } })),
      el('td', {}, amt({ 'aria-label': `납부 ${k + 1} 금액(천원)` }, () => x.amount, (v) => { x.amount = v; }, updateExec)),
      el('td', { class: 'del' }, el('button', { type: 'button', class: 'icon', 'aria-label': `납부 ${k + 1} 삭제`, text: '✕', onclick: () => { mark(); X().paid.splice(k, 1); renderExecPaid(); updateExec(); offerUndo('납부 기록을 삭제했습니다.'); $('xAddPaid').focus(); } }))));
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
          el('td', {}, amt({ placeholder: fmt(r.plan), 'aria-label': `${r.label} 협약 금액(천원, 비우면 편성액)` }, () => ex.agreed[r.key], (v) => { ex.agreed[r.key] = v; }, updateExec)),
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
    $('xEmpty').hidden = E.rows.length > 0; $('xRows').parentElement.hidden = E.rows.length === 0;
    const ps = $('xPaidSum'); if (ps) ps.textContent = `${fmt(E.org.paid)} / ${fmt(E.org.plan)} (최소 ${fmt(E.org.min)})`;
    save();
  }
  $('xXlsx').addEventListener('click', () => {
    const bytes = RB.buildExecXlsx(S, C.i, C.y, today(), projEnd());
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const fname = `${(S.title || '집행현황').replace(/[\\/:*?"<>|]/g, '_')}_${yl(C.y)}_집행현황_${today()}.xlsx`;
    const a = el('a', { href: url, download: fname });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast($('xToast'), `✔ ‘${fname}’ 다운로드됨`);
    track('rb_exec_xlsx');
  });
  // 백업: 과제 전체(편성+집행)를 JSON 파일로 저장·복원
  const doBackupSave = (box) => {
    const data = JSON.stringify({ app: 'rnd-budget', v: 3, savedAt: new Date().toISOString(), project: S }, null, 1);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = el('a', { href: url, download: `사업비_백업_${(S.title || '과제').replace(/[\\/:*?"<>|]/g, '_')}_${today()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    track('rb_backup_save');
    toast(box, `✔ ‘${a.download}’ 백업 저장됨 — 다른 PC·브라우저에서 ‘백업 불러오기’로 이어서 작업할 수 있습니다.`);
  };
  $('backupSave').addEventListener('click', () => doBackupSave($('xToast')));
  $('backupSave2').addEventListener('click', () => doBackupSave($('dlToast')));
  const doBackupLoad = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (/\.xlsx$/i.test(file.name)) { // 이 도구가 만든 엑셀: 숨김 시트의 편성 데이터로 복원
        if (file.size > 20 * 1024 * 1024) throw new Error('size');
        let obj = null;
        try { obj = RB.parseDataCells(await window.RBN.readXlsxDataCells(new Uint8Array(await file.arrayBuffer()), RB.DATA_SHEET)); } catch { obj = null; }
        if (!obj) { await notify('이 엑셀에서는 편성 내용을 찾지 못했습니다. 이 도구에서 내려받은 엑셀(2026-11-17 이후 버전)이거나 ‘백업 저장’으로 받은 .json 파일만 불러올 수 있습니다.'); return; }
        const px = RB.normalizeProject(obj.project);
        if (!(await ask(`엑셀에 함께 저장된 편성 내용(${String(obj.savedAt || '').slice(0, 10) || '저장 시점'}, ${px.title || '제목 없음'})을 불러올까요? 현재 입력은 바뀝니다.\n※ 엑셀에서 직접 고친 금액은 반영되지 않고, 내려받을 때의 편성 내용이 복원됩니다.`))) return;
        mark(); replaceProject(px, C.mode); offerUndo('엑셀에서 편성 내용을 불러왔습니다.'); track('rb_load', { kind: 'xlsx' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) throw new Error('size');
      const obj = JSON.parse(await file.text());
      if (!obj || obj.app !== 'rnd-budget' || !obj.project) throw new Error('format');
      const p = RB.normalizeProject(obj.project);
      if (!(await ask(`백업(${String(obj.savedAt || '').slice(0, 10)}, ${p.title || '제목 없음'})을 불러올까요? 현재 입력은 바뀝니다.`))) return;
      mark(); replaceProject(p, C.mode); // 보고 있던 화면(편성·집행) 유지
      offerUndo('백업을 불러왔습니다.'); track('rb_load', { kind: 'json' });
    } catch { await notify('백업 파일을 읽지 못했습니다. 이 도구에서 저장한 .json 파일인지 확인하세요.'); }
  };
  $('backupLoad').addEventListener('change', doBackupLoad);
  $('backupLoad2').addEventListener('change', doBackupLoad);
  // 파일 선택 버튼(label)을 키보드(Enter·Space)로도 열 수 있게
  document.querySelectorAll('label[data-filebtn]').forEach((l) => l.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); l.querySelector('input[type=file]').click(); } }));

  // ---------- 공고문에서 기준 가져오기(features.noticeImport) ----------
  const NERR = { hwp: 'HWP 파일을 읽지 못했습니다. 한글에서 PDF 또는 HWPX로 저장해 올려 주세요.', 'hwp-locked': '암호가 설정된 HWP 문서입니다. 암호를 해제하거나 PDF로 저장해 올려 주세요.', 'hwp-dist': '배포용(복사 방지) HWP 문서라 읽을 수 없습니다. PDF로 저장해 올려 주세요.', type: 'HWP·HWPX·PDF·TXT 파일만 지원합니다.', size: '파일이 너무 크거나(30MB 초과) 압축이 비정상입니다.', empty: '글자를 찾지 못했습니다. 스캔 이미지 PDF는 읽을 수 없습니다.' };
  const RATE_FIELDS = { govMaxPct: 'govMaxPct', cashMinPct: 'cashMinPct', indirectPct: 'indirectPct', allowanceMaxPct: 'allowanceMaxPct', outsourceMaxPct: 'outsourceMaxPct' };
  const nBox = $('noticeResult');
  async function importNotice(file) {
    if (!file || !window.RBN) return;
    nBox.hidden = false;
    nBox.replaceChildren(el('p', { class: 'hint', text: `‘${file.name}’ 읽는 중…` }));
    let items;
    try { items = window.RBN.extractNotice(await window.RBN.readNoticeFile(file, document.baseURI)); }
    catch (e) { nBox.replaceChildren(el('p', { class: 'nerr', text: NERR[e && e.message] || '파일을 읽지 못했습니다. 다른 형식(PDF·HWPX)으로 저장해 올려 주세요.' })); return; }
    track('rb_notice_import', { ext: (file.name.split('.').pop() || '').toLowerCase().slice(0, 5), found: items.length });
    const picked = window.RBN.pickForType(items, I().ruleset === 'custom' ? I().lastLegal || 'sme' : I().ruleset);
    const order = ['govAnnual', 'govMaxPct', 'cashMinPct', 'indirectPct', 'outsourceMaxPct', 'allowanceMaxPct', 'govTotal', 'periodMonths'];
    const rows = order.map((f) => picked[f]).filter(Boolean);
    const others = items.filter((it) => it.typeKey && !rows.includes(it));
    const head = el('div', { class: 'nhead' }, el('strong', { text: `찾은 기준 ${rows.length}건` }), el('span', { class: 'hint', text: ` — ${file.name} · 근거 문장을 확인하고 적용할 항목을 고르세요.` }));
    if (!rows.length) {
      nBox.replaceChildren(head, el('p', { class: 'hint', text: '사업비 비율·금액 조항을 찾지 못했습니다. 비율 조항이 없는 공고(바우처·컨설팅형 등)이거나 표 안에 있을 수 있습니다. 적용 기준을 직접 확인해 입력하세요.' }));
      return;
    }
    const applicable = (f) => f === 'govAnnual' || RATE_FIELDS[f];
    const curGov = RB.int(Y().gov);
    const tbl = el('table', { class: 'tbl ntbl' },
      el('thead', {}, el('tr', {}, el('th', { text: '적용' }), el('th', { text: '항목' }), el('th', { text: '찾은 값' }), el('th', { text: '공고문 근거' }))),
      el('tbody', {}, ...rows.map((it) => el('tr', {},
        el('td', {}, applicable(it.field) ? el('input', { type: 'checkbox', checked: !(it.field === 'govAnnual' && curGov && curGov !== RB.int(it.value)), 'data-field': it.field, 'aria-label': `${it.label} 적용` }) : el('span', { class: 'hint', text: '참고' })),
        el('td', { text: it.label + (it.type ? ` (${it.type})` : '') }),
        el('td', {}, el('strong', { text: it.display }), it.field === 'govAnnual' && curGov && curGov !== RB.int(it.value) ? el('small', { class: 'hint', text: ` 현재 입력 ${fmt(curGov)}천원 → 바꾸려면 체크(공고 금액은 보통 상한)` }) : ''),
        el('td', { class: 'ev', text: `…${it.evidence}…` })))));
    const note = others.length ? el('p', { class: 'hint', text: `다른 기관 유형 기준도 찾음: ${others.map((o) => `${o.type} ${o.label} ${o.display}`).join(', ')}` }) : '';
    const apply = el('button', { type: 'button', class: 'btn', text: '선택 항목 적용', onclick: () => {
      const on = [...tbl.querySelectorAll('input[data-field]:checked')].map((c) => c.dataset.field);
      if (!on.length) return;
      const inst = I(); mark();
      const before = RB.effectiveRules(inst), EFFK = { allowanceMaxPct: 'allowancePct', outsourceMaxPct: 'outsourcePct' };
      const changes = on.map((f) => (RATE_FIELDS[f] ? `${picked[f].label} ${before[EFFK[f] || f]}% → ${picked[f].value}%` : `정부출연금 ${fmt(curGov)} → ${fmt(picked[f].value)}천원`));
      if (on.some((f) => RATE_FIELDS[f])) {
        const base = RB.effectiveRules(inst);
        inst.govMaxPct = base.govMaxPct; inst.cashMinPct = base.cashMinPct; inst.indirectPct = base.indirectPct; inst.allowanceMaxPct = base.allowancePct; inst.outsourceMaxPct = base.outsourcePct;
        if (inst.ruleset !== 'custom') inst.lastLegal = inst.ruleset;
        inst.ruleset = 'custom';
        for (const f of on) if (RATE_FIELDS[f]) inst[RATE_FIELDS[f]] = picked[f].value;
        inst.noticeSource = file.name;
      }
      if (on.includes('govAnnual')) Y().gov = String(picked.govAnnual.value);
      renderAll();
      $('ruleBox').open = true;
      nBox.replaceChildren(el('p', { class: 'nok', text: `적용했습니다(${on.length}건). 적용 기준이 ‘공고문 기준 직접 입력’으로 바뀌었고, 출처가 표시됩니다.` }), el('ul', { class: 'hd-notes' }, ...changes.map((c) => el('li', { text: c }))));
      offerUndo(`공고문 기준 ${on.length}건을 적용했습니다.`); track('rb_notice_apply', { n: on.length });
    } });
    const close = el('button', { type: 'button', class: 'btn ghost', text: '닫기', onclick: () => { nBox.hidden = true; } });
    nBox.replaceChildren(head, el('div', { class: 'tbl-wrap' }, tbl), note, el('div', { class: 'actions' }, apply, close),
      el('p', { class: 'hint', text: '규칙 기반 자동 추출이라 놓치거나 잘못 읽을 수 있습니다. 반드시 공고문 원문과 대조하세요.' }));
  }
  $('noticeFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importNotice(f); });
  const drop = $('noticeDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); importNotice(e.dataTransfer.files && e.dataTransfer.files[0]); });

  // ---------- 처음 편성 도우미(features.helper) ----------
  const dlg = $('helperDlg');
  let draft = null;
  $('hdRuleset').replaceChildren(...[['기업(영리기관)', ['sme', 'midS', 'midL', 'large']], ['비영리기관', ['univ', 'nonprofit']]]
    .map(([g, keys]) => el('optgroup', { label: g }, ...keys.map((k) => el('option', { value: k, text: RB.RULESETS[k].label })))));
  ['hdGov', 'hdExSal', 'hdHiSal', 'hdEq', 'hdEqIn', 'hdOut', 'hdStu'].forEach((id) => bindAmount($(id), () => {}));
  const hdSync = () => { // 기관 유형에 맞춰 질문 문구 전환(비영리: 현물·신규 채용 구분 없음, 학생인건비 추가)
    const profit = RB.RULESETS[$('hdRuleset').value].profit;
    $('hdLegEx').textContent = profit ? '2. 기존 인력(현물)' : '2. 참여 인력(현금 — 정부출연금)';
    $('hdLegHi').textContent = profit ? '3. 신규 채용(현금)' : '3. 추가 채용 인력(현금)';
    $('hdEqInBox').hidden = !profit; $('hdStuBox').hidden = profit;
  };
  $('hdRuleset').addEventListener('change', hdSync);
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); $('hdMake').click(); } });
  $('helperOpen').addEventListener('click', () => {
    $('hdRuleset').value = RB.RULESETS[I().ruleset] && !RB.RULESETS[I().ruleset].custom ? I().ruleset : 'sme';
    if (RB.int(Y().gov)) $('hdGov').value = groupDigits(Y().gov);
    hdSync(); $('hdPreview').replaceChildren(); $('hdApply').hidden = true; draft = null; track('rb_helper_open');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  const closeHelper = () => { dlg.close ? dlg.close() : dlg.removeAttribute('open'); };
  $('hdClose').addEventListener('click', closeHelper);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeHelper(); }); // 바깥(배경) 클릭 시 닫기
  $('hdMake').addEventListener('click', () => {
    const v = (id) => $(id).value;
    if (!RB.int(v('hdGov'))) { $('hdPreview').replaceChildren(el('p', { class: 'nerr', text: '연간 정부출연금을 입력하세요.' })); $('hdGov').focus(); return; }
    draft = RB.draftBudget({ ruleset: v('hdRuleset'), gov: v('hdGov'), existing: { count: v('hdExN'), salary: v('hdExSal'), rate: v('hdExRate') }, hires: { count: v('hdHiN'), salary: v('hdHiSal'), months: v('hdHiM') }, equipCash: v('hdEq'), equipInkind: v('hdEqIn'), outsource: v('hdOut'), student: v('hdStu') });
    const r = draft.result, errs = r.checks.filter((c) => c.level === 'error');
    const kv = (k, val) => el('div', {}, el('dt', { text: k }), el('dd', { text: val }));
    $('hdPreview').replaceChildren(
      el('dl', { class: 'live-grid' }, kv('총사업비', `${fmt(r.total.total)}천원`), kv('정부출연금', `${fmt(r.funding.gov)}천원`), kv('기관 현금', `${fmt(Math.max(0, r.total.cash - r.funding.gov))}천원`), kv('기관 현물', `${fmt(r.total.inkind)}천원`)),
      el('ul', { class: 'checks' }, ...(errs.length ? errs.map((c) => el('li', { class: 'error', text: c.msg })) : [el('li', { class: 'ok', text: '초안이 법령 기준을 충족합니다.' })])),
      el('ul', { class: 'hd-notes' }, ...draft.notes.map((n) => el('li', { text: n }))));
    $('hdApply').hidden = false;
  });
  $('hdApply').addEventListener('click', async () => {
    if (!draft) return;
    if (hasInput() && (!isExample() || C.dirty) && !(await ask(`${FEAT.project ? `${I().name} · ${yl(C.y)}의 ` : ''}현재 입력을 초안으로 바꿀까요?`))) return;
    const had = hasInput(); mark();
    I().ruleset = $('hdRuleset').value; I().indirectPct = '';
    const d = Y(); d.gov = draft.sheet.gov; d.people = draft.sheet.people; d.items = draft.sheet.items;
    if (isExample()) { S.title = ''; titleIn.value = ''; }
    closeHelper();
    updateDemoNote(); renderAll();
    C.dirty = true; save(); track('rb_helper_apply', { ruleset: I().ruleset });
    if (had) offerUndo('초안을 채웠습니다. 연구재료비 등은 실제 필요 금액에 맞춰 조정하세요.'); else toast($('dlToast'), '초안을 채웠습니다. 연구재료비 등은 실제 필요 금액에 맞춰 조정하세요.');
    $('s1').scrollIntoView({ behavior: 'smooth' }); $('h-fund').focus({ preventScroll: true });
  });

  // ---------- 자주 묻는 질문: 분류 묶음·검색·모두 펼치기 ----------
  const FAQ_CATS = ['기본', '인건비', '현금·현물', '비목', '집행', '도구'];
  const faqAll = [...document.querySelectorAll('#faq details')];
  const faqItems = FAQ_CATS.flatMap((cat) => faqAll.filter((d) => d.dataset.cat === cat)); // 화면에 보이는 순서(분류 순)
  const faqBody = $('faqBody');
  // 분류별 묶음(PC는 2단). 질문은 HTML에 적힌 순서를 분류 안에서 유지
  const faqCols = [el('div', { class: 'faq-col' }), el('div', { class: 'faq-col' })];
  const faqGroups = FAQ_CATS.map((cat, k) => {
    const items = faqItems.filter((d) => d.dataset.cat === cat);
    const g = el('section', { class: 'faq-group', 'data-group': cat, style: `order:${k}` }, el('h3', {}, cat, el('span', { class: 'n', text: `${items.length}` })), ...items);
    faqCols[k % 2].append(g);
    return g;
  });
  faqBody.append(...faqCols);
  faqItems.forEach((d) => d.querySelector('summary').prepend(el('span', { class: 'qcat', text: d.dataset.cat })));
  document.querySelectorAll('#faqCats [data-qcat]').forEach((b) => b.append(el('span', { class: 'n', text: `${b.dataset.qcat ? faqItems.filter((d) => d.dataset.cat === b.dataset.qcat).length : faqItems.length}` })));
  let faqCat = '';
  function syncFaqToggle() {
    const vis = faqItems.filter((d) => !d.hidden), allOpen = vis.length > 0 && vis.every((d) => d.open);
    $('faqToggle').textContent = allOpen ? '모두 접기' : '모두 펼치기';
    $('faqToggle').setAttribute('aria-expanded', String(allOpen));
  }
  function filterFaq() {
    const q = $('faqSearch').value.trim().toLowerCase();
    let shown = 0;
    faqItems.forEach((d) => {
      const ok = (!faqCat || d.dataset.cat === faqCat) && (!q || (d.textContent + ' ' + (d.dataset.kw || '')).toLowerCase().includes(q));
      d.hidden = !ok; if (ok) shown++;
      if (q) d.open = ok && shown <= 3; // 검색 시 위 3건만 펼쳐 한눈에
    });
    faqGroups.forEach((g) => { g.hidden = !g.querySelector('details:not([hidden])'); });
    faqBody.classList.toggle('flat', !!q || !!faqCat); // 검색·분류 선택 시 한 단으로
    $('faqEmpty').hidden = shown > 0;
    $('faqCount').textContent = q ? `‘${$('faqSearch').value.trim()}’ 검색 결과 ${shown}건` : faqCat ? `${faqCat} ${shown}건` : `전체 ${shown}건`;
    syncFaqToggle();
  }
  $('faqSearch').addEventListener('input', filterFaq);
  document.querySelectorAll('#faqCats [data-qcat]').forEach((b) => b.addEventListener('click', () => {
    faqCat = b.dataset.qcat;
    document.querySelectorAll('#faqCats [data-qcat]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    filterFaq();
  }));
  $('faqToggle').addEventListener('click', () => {
    const vis = faqItems.filter((d) => !d.hidden), open = !vis.every((d) => d.open);
    vis.forEach((d) => { d.open = open; });
    syncFaqToggle();
  });
  faqBody.addEventListener('toggle', (e) => { syncFaqToggle(); if (e.target.open && e.isTrusted) track('rb_faq_open', { cat: e.target.dataset.cat, no: faqAll.indexOf(e.target) + 1 }); }, true);
  let faqT; $('faqSearch').addEventListener('input', () => { clearTimeout(faqT); faqT = setTimeout(() => { if ($('faqSearch').value.trim()) track('rb_faq_search', { results: faqItems.filter((d) => !d.hidden).length }); }, 1500); });
  $('faqReset').addEventListener('click', () => { $('faqSearch').value = ''; document.querySelector('#faqCats [data-qcat=""]').click(); $('faqSearch').focus(); });
  filterFaq();

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

  $('xGoPlan').addEventListener('click', () => { setMode('plan'); govIn.focus(); });
  $('liveHelper').hidden = !FEAT.helper;
  $('liveHelper').addEventListener('click', () => $('helperOpen').click());
  // ---------- 공통: 되돌리기·수정 여부·다른 탭·표 안 이동·인쇄 ----------
  $('undoBtn').addEventListener('click', undo);
  $('undoClose').addEventListener('click', () => { $('undoBar').hidden = true; });
  $('main').addEventListener('input', (e) => { if (e.isTrusted !== false && !C.dirty && e.target.type !== 'search' && e.target.id !== 'xlsxName') { C.dirty = true; store.set('rb.cur', C); } });
  let warnedTab = false;
  window.addEventListener('storage', async (e) => {
    if (e.key !== 'rb.current' || warnedTab || !e.newValue) return;
    warnedTab = true;
    if (await ask('다른 탭(창)에서 이 과제를 수정했습니다. 이 탭에서 계속 고치면 그 내용을 덮어씁니다. 최신 내용을 불러올까요?', { okText: '최신 내용 불러오기' })) {
      S = RB.normalizeProject(store.get('rb.current', {})); clampCur(); titleIn.value = S.title; xKeys = ''; updateDemoNote(); renderAll(); setMode(C.mode);
    }
    warnedTab = false;
  });
  // 표 입력 칸: Enter·↓ 는 아래 행 같은 열, ↑ 는 위 행으로 이동
  for (const id of ['people', 'items', 'xGrid', 'xRows']) $(id).addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT' || t.type === 'date' || !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key) || e.isComposing) return;
    const td = t.closest('td'), tr = td.parentElement, col = [...tr.children].indexOf(td), dir = e.key === 'ArrowUp' ? 'previousElementSibling' : 'nextElementSibling';
    let row = tr[dir];
    while (row && !(row.children[col] && row.children[col].querySelector('input') && !row.hidden)) row = row[dir];
    if (row) { e.preventDefault(); const n = row.children[col].querySelector('input'); n.focus(); n.select(); }
  });
  let printOpened = [];
  window.addEventListener('beforeprint', () => {
    const rs = RB.RULESETS[I().ruleset];
    $('printHead').textContent = `${S.title || '(과제명 미입력)'} · ${FEAT.project ? `${I().name} · ${yl(C.y)} · ` : ''}${rs.label} · 단위: 천원 · 출력일 ${today()} · 법령 기준일 ${RB.BASIS_DATE}`;
    printOpened = [$('ruleBox'), $('passedBox')].filter((d) => !d.open); printOpened.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => { printOpened.forEach((d) => { d.open = false; }); printOpened = []; });

  if (PREVIEW) { $('previewBar').hidden = false; $('previewOff').addEventListener('click', () => { try { localStorage.removeItem('rb.preview'); } catch { /* 무시 */ } location.reload(); }); }
  renderAll(); renderScenarios();
  setMode(C.mode); syncProjBox();
})();
