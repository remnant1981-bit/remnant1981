// R&D 사업비 계산 로직(순수 함수). 금액 단위: 천원(정수).
// 기준: 국가연구개발혁신법 시행령 별표 1(2024.12.31. 개정), 「국가연구개발사업 연구개발비 사용 기준」(과기정통부고시 제2026-38호, 2026.5.6. 시행).
// 사업별 공고·운영요령에서 비율을 달리 정하면 그 기준이 우선(화면 '공고문 기준 직접 입력').
(function (root) {
  'use strict';

  const BASIS_DATE = '2026-11-13';
  const SOURCES = {
    decreeT1: '국가연구개발혁신법 시행령 제19조·별표 1(2024.12.31. 개정)',
    std: '국가연구개발사업 연구개발비 사용 기준(과기정통부고시 제2026-38호, 2026.5.6. 시행)',
  };

  // 기관 유형별 법정 기준. profit=영리기관(학생인건비 대상 아님, 간접비 현금·고시비율 10% 이내)
  const RULESETS = {
    sme: { label: '중소기업', govMaxPct: 75, cashMinPct: 10, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 75% 이하', cash: '시행령 별표 1 제2호: 기관부담금의 10% 이상 현금', indirect: '사용 기준 제114조④: 영리기관 간접비고시비율 10%' } },
    midS: { label: '중견기업(평균매출액등 3천억 원 미만)', govMaxPct: 70, cashMinPct: 10, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 70% 이하', cash: '시행령 별표 1 제2호·비고 2: 3천억 원 미만 중견 10% 이상 현금', indirect: '사용 기준 제114조④: 영리기관 10%' } },
    midL: { label: '중견기업(평균매출액등 3천억 원 이상)', govMaxPct: 70, cashMinPct: 13, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 70% 이하', cash: '시행령 별표 1 제2호: 중견기업 13% 이상 현금', indirect: '사용 기준 제114조④: 영리기관 10%' } },
    large: { label: '대기업·공기업', govMaxPct: 50, cashMinPct: 15, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 50% 이하', cash: '시행령 별표 1 제2호: 공기업·대기업 15% 이상 현금', indirect: '사용 기준 제114조④: 영리기관(공기업 포함) 10%' } },
    univ: { label: '대학', govMaxPct: 100, cashMinPct: 0, indirectPct: 5, indirectMax: 100, profit: false,
      basis: { gov: '시행령 제19조①: 비영리기관은 기관부담 의무 없음', cash: '기관부담 의무 없음', indirect: '사용 기준 제114조②: 고시비율 없는 대학 5%(고시비율 있으면 그 비율 입력)' } },
    nonprofit: { label: '비영리기관(대학 외)', govMaxPct: 100, cashMinPct: 0, indirectPct: 17, indirectMax: 100, profit: false,
      basis: { gov: '시행령 제19조①: 비영리기관은 기관부담 의무 없음', cash: '기관부담 의무 없음', indirect: '사용 기준 제114조③: 고시비율 없는 비영리기관 17%(고시비율 있으면 그 비율 입력)' } },
    custom: { label: '공고문 기준 직접 입력', govMaxPct: 75, cashMinPct: 10, indirectPct: 10, indirectMax: 100, profit: true, custom: true,
      basis: { gov: '공고문·운영요령 기준', cash: '공고문·운영요령 기준', indirect: '기관 간접비 고시비율' } },
  };

  // 공통 한도(사용 기준)
  const LIMITS = {
    allowancePct: 20, // 제26조①: 수정인건비(현물 포함 인건비+학생인건비)의 20% 이내
    outsourcePct: 40, // 제27조①: (직접비 − 위탁 − 국제공동 − 연구개발부담비)의 40% 이하
    rateMax: 100, // 제65조⑦: 영리기관 참여연구자 총인건비계상률 월 100% 이하
  };

  // 비목(직접비). inkind=현물 계상 가능(시행령 별표 1 제3호), profitOnly/nonprofitOnly 표시 조건
  const ITEMS = [
    { key: 'personnel', label: '인건비', inkind: true },
    { key: 'student', label: '학생인건비', inkind: false, nonprofitOnly: true },
    { key: 'equipment', label: '연구시설·장비비', inkind: true },
    { key: 'material', label: '연구재료비', inkind: true },
    { key: 'outsource', label: '위탁연구개발비', inkind: false },
    { key: 'activity', label: '연구활동비', inkind: false },
    { key: 'allowance', label: '연구수당', inkind: false },
  ];

  // 인력 구분(사용 기준 제64조②): 기존 인력=현물 원칙, 신규 채용=현금, 부처 인정 시 기존 인력 현금
  const PERSON_KINDS = {
    existing: { label: '기존 인력(현물)', inkind: true },
    new: { label: '신규 채용(현금)', inkind: false },
    existingCash: { label: '기존 인력 현금(부처 인정 시)', inkind: false },
  };


  // 체험용 예시(데모). 정상 편성(2기관·2연차), 점검 오류 확인용(1기관·1연차)
  const P = (name, salary, months, rate, otherRate, kind) => ({ name, salary, months, rate, otherRate, kind });
  const EXAMPLES = {
    ok: { label: '정상 편성 예시(주관 중소 + 공동 대학, 2개 연차)', state: { v: 2, title: '[예시] 액체수소 이송용 극저온 펌프 개발', years: 2, insts: [
      { name: '(주)예시테크', role: 'lead', ruleset: 'sme', data: [
        { gov: '300000', people: [P('김책임', '84000', 12, 30, 40, 'existing'), P('이선임', '62000', 12, 50, 30, 'existing'), P('박연구', '48000', 12, 60, 20, 'existing'), P('신규연구원', '42000', 10, 100, 0, 'new')],
          items: { equipment: { cash: '60000', inkind: '15000' }, material: { cash: '120000', inkind: '10000' }, outsource: { cash: '40000' }, activity: { cash: '25000' }, allowance: { cash: '9000' } } },
        { gov: '300000', people: [P('김책임', '87000', 12, 30, 40, 'existing'), P('이선임', '64000', 12, 50, 30, 'existing'), P('박연구', '50000', 12, 60, 20, 'existing'), P('신규연구원', '44000', 12, 100, 0, 'new')],
          items: { equipment: { cash: '30000', inkind: '10000' }, material: { cash: '140000', inkind: '15000' }, outsource: { cash: '40000' }, activity: { cash: '30000' }, allowance: { cash: '9000' } } },
      ] },
      { name: '예시대학교 산학협력단', role: 'joint', ruleset: 'univ', data: [
        { gov: '100000', people: [], items: { student: { cash: '50000' }, material: { cash: '30000' }, activity: { cash: '10239' }, allowance: { cash: '5000' } } },
        { gov: '100000', people: [], items: { student: { cash: '52000' }, material: { cash: '28000' }, activity: { cash: '10239' }, allowance: { cash: '5000' } } },
      ] },
    ] } },
    error: { label: '오류 점검 예시(중견 3천억 미만)', state: { v: 2, title: '[예시] 점검 오류 확인용', years: 1, insts: [
      { name: '(주)예시중견', role: 'lead', ruleset: 'midS', data: [
        { gov: '400000', people: [P('최수석', '90000', 12, 70, 50, 'existing'), P('정선임', '60000', 12, 50, 0, 'existingCash')],
          items: { equipment: { inkind: '40000' }, material: { cash: '150000', inkind: '60000' }, outsource: { cash: '160000' }, activity: { cash: '10000' }, allowance: { cash: '30000' } } },
      ] },
    ] } },
  };

  const DEFAULT_RULES = { indirectPct: 10, allowanceMaxPct: LIMITS.allowancePct };

  const int = (v) => {
    const n = Math.round(Number(String(v ?? '').replace(/[,\s]/g, '')));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const pct = (v, max = 100) => {
    const n = Number(String(v ?? '').replace(/[,%\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };
  const personKind = (p) => (p.kind && PERSON_KINDS[p.kind] ? p.kind : p.inkind ? 'existing' : 'new');

  /** 적용 비율: 법령 유형이면 고정값(간접비만 상한 내 조정), 직접 입력이면 사용자 값 */
  function effectiveRules(s) {
    const rs = RULESETS[s.ruleset] || RULESETS.sme;
    if (rs.custom) {
      return { ...rs, govMaxPct: pct(s.govMaxPct), cashMinPct: pct(s.cashMinPct), indirectPct: s.indirectPct === undefined || s.indirectPct === '' ? rs.indirectPct : pct(s.indirectPct), allowancePct: s.allowanceMaxPct === undefined || s.allowanceMaxPct === '' ? LIMITS.allowancePct : pct(s.allowanceMaxPct), outsourcePct: LIMITS.outsourcePct };
    }
    const ind = s.indirectPct === undefined || s.indirectPct === '' ? rs.indirectPct : Math.min(pct(s.indirectPct), rs.indirectMax);
    return { ...rs, indirectPct: ind, allowancePct: LIMITS.allowancePct, outsourcePct: LIMITS.outsourcePct };
  }

  /** 정부출연금 → 최소 총사업비·기관부담금·최소 현금 */
  function calcFunding(gov, govMaxPct, cashMinPct) {
    gov = int(gov); govMaxPct = pct(govMaxPct); cashMinPct = pct(cashMinPct);
    if (!gov || !govMaxPct) return { gov, total: gov, org: 0, cashMin: 0, inkindMax: 0 };
    const total = Math.ceil((gov * 100) / govMaxPct);
    const org = total - gov;
    const cashMin = Math.ceil((org * cashMinPct) / 100);
    return { gov, total, org, cashMin, inkindMax: org - cashMin };
  }

  /** 참여연구원 1명 인건비 = 연봉 ÷ 12 × 참여개월 × 참여율(사용 기준 제65조: 월 급여 × 인건비계상률) */
  function personCost(p) {
    const salary = int(p.salary), months = Math.min(int(p.months), 12), rate = pct(p.rate);
    return Math.round((salary / 12) * months * (rate / 100));
  }

  /**
   * 전체 편성 계산
   * state: { ruleset, gov, govMaxPct, cashMinPct, indirectPct, allowanceMaxPct, people:[{name,salary,months,rate,otherRate,kind}], items:{key:{cash,inkind}} }
   */
  function calcBudget(state) {
    const s = state || {};
    const rules = effectiveRules(s);
    const funding = calcFunding(s.gov, rules.govMaxPct, rules.cashMinPct);
    const people = (s.people || []).map((p) => {
      const kind = personKind(p);
      return { ...p, kind, inkind: PERSON_KINDS[kind].inkind, cost: personCost(p), totalRate: pct(p.rate, 1000) + pct(p.otherRate, 1000) };
    });
    const rows = ITEMS.filter((it) => !(it.nonprofitOnly && rules.profit)).map((it) => {
      const v = (s.items && s.items[it.key]) || {};
      let cash = int(v.cash), inkind = it.inkind ? int(v.inkind) : 0;
      if (it.key === 'personnel') {
        cash = people.filter((p) => !p.inkind).reduce((a, p) => a + p.cost, 0);
        inkind = people.filter((p) => p.inkind).reduce((a, p) => a + p.cost, 0);
      }
      return { key: it.key, label: it.label, cash, inkind, total: cash + inkind };
    });
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const direct = { cash: sum('cash'), inkind: sum('inkind'), total: sum('total') };
    const get = (k) => rows.find((r) => r.key === k) || { cash: 0, inkind: 0, total: 0 };
    const outsource = get('outsource').total;
    const indirectPct = rules.indirectPct;
    // 수정직접비(사용 기준 제2조9호) = 직접비 − 현물 − 위탁연구개발비. 간접비는 현금
    const indirectBase = Math.max(0, direct.total - direct.inkind - outsource);
    const indirect = Math.floor((indirectBase * indirectPct) / 100);
    rows.push({ key: 'indirect', label: '간접비', cash: indirect, inkind: 0, total: indirect, computed: true });
    const total = { cash: direct.cash + indirect, inkind: direct.inkind, total: direct.total + indirect };
    const checks = runChecks({ s, rules, funding, get, direct, total, people, indirectBase, indirectPct, outsource });
    return { rules, funding, people, rows, direct, indirectBase, indirect, total, checks };
  }

  function runChecks({ rules, funding, get, direct, total, people, indirectBase, indirectPct, outsource }) {
    const out = [];
    const add = (level, msg, basis) => out.push({ level, msg, basis: basis || '' });
    const fmt = (n) => n.toLocaleString('ko-KR');
    const gov = funding.gov;
    if (!gov) { add('info', '정부출연금(정부지원연구개발비)을 입력하면 기관부담금과 편성 점검 결과가 표시됩니다.'); return out; }
    if (!total.total) { add('info', `최소 총사업비 ${fmt(funding.total)}천원에 맞춰 비목을 편성하세요.`); return out; }

    const { govMaxPct, cashMinPct } = rules;
    const govShare = (gov / total.total) * 100;
    if (total.total < funding.total) add('error', `총사업비가 최소 총사업비보다 ${fmt(funding.total - total.total)}천원 부족합니다(정부지원 비율 ${govShare.toFixed(1)}% > ${govMaxPct}%).`, rules.basis.gov);
    else add('ok', `총사업비 ${fmt(total.total)}천원 — 정부지원 비율 ${govShare.toFixed(1)}%(한도 ${govMaxPct}%).`, rules.basis.gov);

    const org = total.total - gov;
    const orgCash = total.cash - gov;
    if (orgCash < 0) add('error', `현금 편성 ${fmt(total.cash)}천원이 정부출연금보다 ${fmt(-orgCash)}천원 적습니다. 정부출연금은 전액 현금 비목으로 편성해야 합니다.`);
    else if (org > 0 && cashMinPct > 0) {
      const need = Math.ceil((org * cashMinPct) / 100);
      if (orgCash < need) add('error', `기관부담금 중 현금 ${fmt(orgCash)}천원 — 최소 ${fmt(need)}천원(${cashMinPct}%)보다 ${fmt(need - orgCash)}천원 부족합니다.`, rules.basis.cash);
      else add('ok', `기관부담금 ${fmt(org)}천원 = 현금 ${fmt(orgCash)} + 현물 ${fmt(total.inkind)}(현금 ${((orgCash / org) * 100).toFixed(1)}%, 최소 ${cashMinPct}%).`, rules.basis.cash);
    }

    // 연구수당: 수정인건비(현물 포함 인건비 + 학생인건비)의 20% 이내
    const personnel = get('personnel').total + get('student').total;
    const allowance = get('allowance').total;
    const allowanceMax = Math.floor((personnel * rules.allowancePct) / 100);
    if (allowance > allowanceMax) add('error', `연구수당 ${fmt(allowance)}천원이 한도 ${fmt(allowanceMax)}천원(인건비·학생인건비의 ${rules.allowancePct}%)을 넘습니다.`, '사용 기준 제26조①');
    else if (allowance) add('ok', `연구수당 ${fmt(allowance)}천원 — 한도 ${fmt(allowanceMax)}천원 이내.`, '사용 기준 제26조①');

    // 위탁연구개발비: (직접비 − 위탁)의 40% 이하
    if (outsource) {
      const base = direct.total - outsource;
      const max = Math.floor((base * rules.outsourcePct) / 100);
      if (outsource > max) add('error', `위탁연구개발비 ${fmt(outsource)}천원이 한도 ${fmt(max)}천원((직접비 − 위탁) ${fmt(base)}의 ${rules.outsourcePct}%)을 넘습니다. 부처가 인정한 경우만 초과 가능.`, '사용 기준 제27조①');
      else add('ok', `위탁연구개발비 ${fmt(outsource)}천원 — 한도 ${fmt(max)}천원 이내.`, '사용 기준 제27조①');
    }

    for (const p of people) {
      const name = p.name || '이름 없음';
      if (p.totalRate > LIMITS.rateMax) add('error', `${name}: 총 참여율 ${p.totalRate}%(이 과제 ${pct(p.rate, 1000)}% + 다른 과제 ${pct(p.otherRate, 1000)}%)가 100%를 넘습니다.`, '사용 기준 제65조⑦');
      if (p.cost === 0 && (p.name || p.salary)) add('warn', `${name}: 연봉·참여개월·참여율을 확인하세요(인건비 0).`);
      if (p.kind === 'existingCash' && rules.profit) add('warn', `${name}: 기존 인력 인건비는 원칙적으로 현물입니다. 현금 계상은 부처(전문기관)가 인정한 경우에만 가능합니다.`, '사용 기준 제64조②');
    }
    const equip = get('equipment').total;
    if (equip >= 30000) add('warn', `연구시설·장비비 ${fmt(equip)}천원 — 3천만 원 이상 장비는 ZEUS 공동활용 확인이 필요하고, 1억 원 이상은 시설·장비 표준지침 절차를 따릅니다(장비 1건 기준).`, '사용 기준 제23조');
    if (indirectBase && !indirectPct) add('warn', '간접비율이 0%입니다. 기관 고시 비율 또는 공고문 기준을 입력하세요.');
    add('info', `간접비 = 수정직접비(직접비 − 현물 − 위탁) ${fmt(indirectBase)}천원 × ${indirectPct}% = ${fmt(Math.floor((indirectBase * indirectPct) / 100))}천원(현금).`, rules.basis.indirect);
    return out;
  }

  // ---------- 과제(연차 × 기관) ----------
  // project v2: { v:2, title, years, insts:[{ name, role:'lead'|'joint', ruleset, govMaxPct, cashMinPct, indirectPct, allowanceMaxPct, data:[{gov, people, items}] }] }
  const MAX_YEARS = 5, MAX_INSTS = 10;
  const ROLES = { lead: '주관연구개발기관', joint: '공동연구개발기관' };
  const blankYear = () => ({ gov: '', people: [{ name: '', salary: '', months: 12, rate: '', otherRate: '', kind: 'existing' }], items: {} });
  const newInst = (role = 'joint', n = 1) => ({ name: role === 'lead' ? '주관기관' : `공동기관 ${n}`, role, ruleset: 'sme', govMaxPct: '', cashMinPct: '', indirectPct: '', allowanceMaxPct: '', data: [blankYear()] });

  /** 이전 버전(단일 기관·단일 연차) 저장값 포함 → v2 로 정리 */
  function normalizeProject(raw) {
    const s = raw && typeof raw === 'object' ? JSON.parse(JSON.stringify(raw)) : {};
    let p;
    if (s.v === 2 && Array.isArray(s.insts)) p = s;
    else {
      const ruleset = s.ruleset || ({ sme: 'sme', mid: 'midL', large: 'large', custom: 'custom' })[s.orgType] || 'sme';
      p = { v: 2, title: s.title || '', years: 1, insts: [{ name: '주관기관', role: 'lead', ruleset, govMaxPct: s.govMaxPct ?? '', cashMinPct: s.cashMinPct ?? '', indirectPct: s.indirectPct ?? '', allowanceMaxPct: s.allowanceMaxPct ?? '',
        data: [{ gov: s.gov ?? '', people: Array.isArray(s.people) ? s.people : blankYear().people, items: s.items && typeof s.items === 'object' ? s.items : {} }] }] };
    }
    p.title = String(p.title || '').slice(0, 80);
    p.years = Math.min(MAX_YEARS, Math.max(1, Math.floor(Number(p.years) || 1)));
    p.insts = (p.insts || []).slice(0, MAX_INSTS);
    if (!p.insts.length) p.insts = [newInst('lead')];
    for (const inst of p.insts) {
      if (!RULESETS[inst.ruleset]) inst.ruleset = 'sme';
      if (!ROLES[inst.role]) inst.role = 'joint';
      inst.name = String(inst.name || '').slice(0, 40) || '기관';
      inst.data = Array.isArray(inst.data) ? inst.data.slice(0, MAX_YEARS) : [];
      while (inst.data.length < p.years) inst.data.push(blankYear());
      for (const d of inst.data) { d.people = Array.isArray(d.people) ? d.people : []; d.items = d.items && typeof d.items === 'object' ? d.items : {}; }
    }
    return p;
  }

  /** 한 기관·한 연차의 계산용 상태(calcBudget 입력) */
  function sheetState(p, i, y) {
    const inst = p.insts[i], d = inst.data[y];
    return { ruleset: inst.ruleset, govMaxPct: inst.govMaxPct, cashMinPct: inst.cashMinPct, indirectPct: inst.indirectPct, allowanceMaxPct: inst.allowanceMaxPct, gov: d.gov, people: d.people, items: d.items };
  }

  const sumT = (list) => list.reduce((a, t) => ({ gov: a.gov + t.gov, orgCash: a.orgCash + t.orgCash, inkind: a.inkind + t.inkind, total: a.total + t.total }), { gov: 0, orgCash: 0, inkind: 0, total: 0 });

  /** 과제 전체 계산: 기관·연차별 결과, 연차·기관·전체 합계, 과제 단위 점검 */
  function calcProject(raw) {
    const p = normalizeProject(raw);
    const insts = p.insts.map((inst, i) => {
      const years = [];
      for (let y = 0; y < p.years; y++) {
        const r = calcBudget(sheetState(p, i, y));
        const gov = r.funding.gov;
        r.sum = { gov, orgCash: Math.max(0, r.total.cash - gov), inkind: r.total.inkind, total: r.total.total };
        r.errors = r.checks.filter((c) => c.level === 'error').length;
        years.push(r);
      }
      return { name: inst.name, role: inst.role, rules: years[0].rules, years, total: sumT(years.map((r) => r.sum)) };
    });
    const yearTotals = Array.from({ length: p.years }, (_, y) => sumT(insts.map((it) => it.years[y].sum)));
    const total = sumT(yearTotals);
    const checks = [];
    const leads = p.insts.filter((x) => x.role === 'lead').length;
    if (leads !== 1) checks.push({ level: 'warn', msg: `주관연구개발기관은 1곳이어야 합니다(현재 ${leads}곳).` });
    const errs = insts.reduce((a, it) => a + it.years.reduce((b, r) => b + r.errors, 0), 0);
    if (errs) checks.push({ level: 'error', msg: `기관·연차별 편성에 오류 ${errs}건이 있습니다. 총괄표에서 ✖ 표시된 칸을 눌러 확인하세요.` });
    else if (total.gov) checks.push({ level: 'ok', msg: '모든 기관·연차 편성이 점검을 통과했습니다.' });
    return { project: p, insts, yearTotals, total, checks };
  }

  /** 계획서용 비목 배분: 현금을 정부지원·기관부담 현금으로 비례 배분(나머지는 가장 큰 비목) */
  function splitCash(r) {
    const rows = r.rows.map((x) => ({ ...x, gov: 0, orgCash: 0 }));
    const cashTotal = rows.reduce((a, x) => a + x.cash, 0);
    const gov = Math.min(r.funding.gov, cashTotal);
    if (cashTotal > 0) {
      let used = 0;
      for (const x of rows) { x.gov = Math.floor((x.cash * gov) / cashTotal); used += x.gov; }
      const big = rows.reduce((a, x) => (x.cash > a.cash ? x : a), rows[0]);
      big.gov += gov - used;
    }
    for (const x of rows) x.orgCash = x.cash - x.gov;
    return rows;
  }

  // ---------- XLSX — 의존성 없는 최소 생성기(무압축 ZIP) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  function zip(files) {
    const enc = new TextEncoder();
    const chunks = []; const central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name); const data = enc.encode(f.data); const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => String.fromCharCode(65 + i);
  /** rows: 셀 배열의 배열. 셀: 문자열 | 숫자 | {f:'수식'} | {v, s:스타일번호} */
  function sheetXml(rows, widths) {
    const cell = (v, r, c) => {
      const ref = colName(c) + (r + 1);
      let style = 0;
      if (v && typeof v === 'object' && 's' in v) { style = v.s; v = 'f' in v ? { f: v.f } : v.v; }
      const sAttr = style ? ` s="${style}"` : '';
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number') return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
      if (typeof v === 'object' && v.f) return `<c r="${ref}"${sAttr}><f>${esc(v.f)}</f></c>`;
      return `<c r="${ref}" t="inlineStr"${sAttr}><is><t>${esc(v)}</t></is></c>`;
    };
    const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
  }

  /** 편성표 XLSX(합계는 엑셀 수식) */
  const RB_KIND_LABEL = (p) => PERSON_KINDS[personKind(p)].label;
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EFFF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6"><xf/><xf numFmtId="3" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/><xf borderId="1" applyBorder="1"/><xf numFmtId="3" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  // 스타일 번호: 1 숫자, 2 굵게, 3 테두리, 4 테두리+숫자, 5 표 머리(굵게·배경·테두리)
  const sheetName = (s, used) => {
    let n = String(s).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 28) || '시트';
    let k = n, i = 2;
    while (used.has(k)) k = `${n.slice(0, 26)}(${i++})`;
    used.add(k);
    return k;
  };

  function workbook(sheets) {
    const n = sheets.length;
    const ct = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const wbSheets = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
    return zip([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ct}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets}</sheets><calcPr fullCalcOnLoad="1"/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) })),
    ]);
  }

  /**
   * 계획서 양식 엑셀: ① 연구개발비 총괄표(연차·기관별 정부지원/기관부담 현금·현물) ② 기관별 비목 사용계획(연차별 + 전체)
   * ③ 참여연구원 인건비 명세 ④ 적용 기준·근거. 합계·소계는 엑셀 수식.
   */
  function buildXlsx(raw) {
    const P = calcProject(raw);
    const p = P.project;
    const N = 1, B = 2, T = 3, TN = 4, H = 5;
    const title = p.title || 'R&D 과제';
    const used = new Set();
    const yl = (y) => `${y + 1}차년도`;
    const head = (...v) => v.map((x) => ({ v: x, s: H }));
    const num = (v) => ({ v, s: TN });
    const f = (x) => ({ f: x, s: TN });
    const txt = (v) => ({ v, s: T });

    // ① 총괄표
    const t1 = [[{ v: `${title} — 연구개발비 총괄표`, s: B }], ['단위: 천원'], [],
      head('연차', '기관명', '역할', '정부지원연구개발비', '기관부담 현금', '기관부담 현물', '합계', '정부지원 비율(%)')];
    const subRows = [];
    for (let y = 0; y < p.years; y++) {
      const first = t1.length + 1;
      P.insts.forEach((it) => {
        const n = t1.length + 1, s = it.years[y].sum;
        t1.push([txt(yl(y)), txt(it.name), txt(ROLES[it.role]), num(s.gov), num(s.orgCash), num(s.inkind), f(`SUM(D${n}:F${n})`), f(`IF(G${n}=0,0,ROUND(D${n}/G${n}*100,1))`)]);
      });
      const last = t1.length, n = last + 1;
      t1.push([{ v: `${yl(y)} 소계`, s: H }, txt(''), txt(''), f(`SUM(D${first}:D${last})`), f(`SUM(E${first}:E${last})`), f(`SUM(F${first}:F${last})`), f(`SUM(G${first}:G${last})`), f(`IF(G${n}=0,0,ROUND(D${n}/G${n}*100,1))`)]);
      subRows.push(n);
    }
    const gt = t1.length + 1;
    const sumOf = (c) => subRows.map((r) => `${c}${r}`).join('+');
    t1.push([{ v: '총 합계', s: H }, txt(''), txt(''), f(sumOf('D')), f(sumOf('E')), f(sumOf('F')), f(sumOf('G')), f(`IF(G${gt}=0,0,ROUND(D${gt}/G${gt}*100,1))`)]);
    t1.push([], ['※ 기관부담 현금 = 현금 편성액 − 정부지원연구개발비. 사업별 공고문·운영요령이 우선합니다.']);
    const sheets = [{ name: sheetName('총괄표', used), rows: t1, widths: [12, 26, 18, 18, 15, 15, 16, 14] }];

    // ② 기관별 비목 사용계획
    P.insts.forEach((it, i) => {
      const rows = [[{ v: `${title} — ${it.name}(${ROLES[it.role]}) 연구개발비 사용계획`, s: B }], [`단위: 천원 · 적용 기준: ${it.rules.label}`], []];
      const blocks = [];
      const block = (label, getRows) => {
        rows.push([{ v: label, s: B }]);
        rows.push(head('구분', '비목', '정부지원연구개발비', '기관부담 현금', '기관부담 현물', '합계'));
        const start = rows.length + 1;
        const list = getRows();
        const directRows = [];
        let indirectRow = 0;
        list.forEach((x) => {
          const n = rows.length + 1;
          if (x.key === 'indirect') {
            const ds = rows.length + 1;
            rows.push([txt('직접비'), { v: '소계', s: H }, f(`SUM(C${start}:C${ds - 1})`), f(`SUM(D${start}:D${ds - 1})`), f(`SUM(E${start}:E${ds - 1})`), f(`SUM(F${start}:F${ds - 1})`)]);
            indirectRow = rows.length + 1;
            rows.push([txt('간접비'), txt('간접비'), x.cGov, x.cOrg, x.cInk, f(`SUM(C${indirectRow}:E${indirectRow})`)]);
            blocks.push({ ds, indirectRow });
            return;
          }
          rows.push([txt('직접비'), txt(x.label), x.cGov, x.cOrg, x.cInk, f(`SUM(C${n}:E${n})`)]);
          directRows.push(n);
        });
        const { ds } = blocks[blocks.length - 1];
        const tn = rows.length + 1;
        rows.push([{ v: '합계', s: H }, txt(''), f(`C${ds}+C${indirectRow}`), f(`D${ds}+D${indirectRow}`), f(`E${ds}+E${indirectRow}`), f(`F${ds}+F${indirectRow}`)]);
        rows.push([]);
        return { start, tn, count: list.length };
      };
      const yearBlocks = [];
      for (let y = 0; y < p.years; y++) {
        const r = it.years[y];
        const split = splitCash(r);
        yearBlocks.push(block(`■ ${yl(y)}  (정부지원 ${r.funding.gov.toLocaleString('ko-KR')}천원)`, () => split.map((x) => ({ key: x.key, label: x.label, cGov: num(x.gov), cOrg: num(x.orgCash), cInk: num(x.inkind) }))));
      }
      if (p.years > 1) {
        const labels = it.years[0].rows.map((x) => ({ key: x.key, label: x.label }));
        // 전체 연차 합계: 각 연차 블록의 같은 행(비목 순서 동일)을 더함. 소계 행이 끼어 있어 간접비는 +1 오프셋
        block('■ 전체 연차 합계', () => labels.map((x, k) => {
          const off = x.key === 'indirect' ? k + 1 : k;
          const ref = (c) => ({ f: yearBlocks.map((b) => `${c}${b.start + off}`).join('+'), s: TN });
          return { key: x.key, label: x.label, cGov: ref('C'), cOrg: ref('D'), cInk: ref('E') };
        }));
      }
      rows.push(['※ 현금 편성액을 정부지원·기관부담 현금으로 비례 배분한 값입니다. 계획서 작성 시 비목별로 조정하세요(합계는 유지).']);
      sheets.push({ name: sheetName(`${i + 1}.${it.name}`, used), rows, widths: [10, 20, 18, 15, 15, 16] });
    });

    // ③ 인건비 명세
    const t3 = [[{ v: `${title} — 참여연구원 인건비 명세`, s: B }], ['단위: 천원 · 인건비 = 연봉 ÷ 12 × 참여개월 × 참여율'], [],
      head('기관명', '연차', '성명', '연봉', '참여개월', '참여율(%)', '다른 과제 참여율(%)', '구분', '인건비')];
    const pStart = t3.length + 1;
    p.insts.forEach((inst) => inst.data.slice(0, p.years).forEach((d, y) => d.people.filter((x) => x.name || int(x.salary)).forEach((x) => {
      const n = t3.length + 1;
      t3.push([txt(inst.name), txt(yl(y)), txt(x.name || ''), num(int(x.salary)), { v: Math.min(int(x.months), 12), s: T }, { v: pct(x.rate), s: T }, { v: pct(x.otherRate), s: T }, txt(RB_KIND_LABEL(x)), f(`ROUND(D${n}/12*E${n}*F${n}/100,0)`)]);
    })));
    if (t3.length >= pStart) t3.push([{ v: '합계', s: H }, txt(''), txt(''), txt(''), txt(''), txt(''), txt(''), txt(''), f(`SUM(I${pStart}:I${t3.length})`)]);
    sheets.push({ name: sheetName('인건비 명세', used), rows: t3, widths: [24, 10, 12, 12, 10, 10, 18, 22, 12] });

    // ④ 적용 기준
    const t4 = [[{ v: '적용 기준·근거', s: B }], [], head('기관명', '기관 유형', '정부지원 상한(%)', '기관부담 현금(%)', '간접비율(%)', '근거')];
    P.insts.forEach((it) => {
      const r = it.rules;
      t4.push([txt(it.name), txt(r.label), { v: r.govMaxPct, s: T }, { v: r.cashMinPct, s: T }, { v: r.indirectPct, s: T }, txt(`${r.basis.gov} / ${r.basis.cash} / ${r.basis.indirect}`)]);
    });
    t4.push([], ['공통 한도', '연구수당: 수정인건비의 20% 이내(사용 기준 제26조①) · 위탁연구개발비: (직접비 − 위탁)의 40% 이하(제27조①) · 영리기관 총 참여율 100% 이하(제65조⑦)'],
      ['근거 법령', `${SOURCES.decreeT1} / ${SOURCES.std}`], ['기준일', BASIS_DATE],
      [], ['※ 참고용 계산입니다. 사업별 공고문·운영요령·협약이 우선합니다.']);
    sheets.push({ name: sheetName('적용 기준', used), rows: t4, widths: [24, 30, 16, 16, 12, 90] });
    return workbook(sheets);
  }

  const RB = { MAX_YEARS, MAX_INSTS, ROLES, blankYear, newInst, normalizeProject, sheetState, calcProject, splitCash, EXAMPLES, BASIS_DATE, SOURCES, RULESETS, LIMITS, ITEMS, PERSON_KINDS, DEFAULT_RULES, int, pct, effectiveRules, calcFunding, personCost, calcBudget, buildXlsx, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = RB;
  else root.RB = RB;
})(typeof self !== 'undefined' ? self : this);
