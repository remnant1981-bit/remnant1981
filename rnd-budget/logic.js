// R&D 사업비 계산 로직(순수 함수). 금액 단위: 천원(정수).
// 기준: 국가연구개발혁신법 시행령 별표 1(2026.3.10. 개정), 「국가연구개발사업 연구개발비 사용 기준」(과기정통부고시 제2026-38호, 2026.5.6. 시행).
// 사업별 공고·운영요령에서 비율을 달리 정하면 그 기준이 우선(화면 '공고문 기준 직접 입력').
(function (root) {
  'use strict';

  const BASIS_DATE = '2026-11-16';
  const SOURCES = {
    decreeT1: '국가연구개발혁신법 시행령 제19조·별표 1(2026.3.10. 개정)',
    std: '국가연구개발사업 연구개발비 사용 기준(과기정통부고시 제2026-38호, 2026.5.6. 시행)',
  };

  // 기관 유형별 법정 기준. profit=영리기관(학생인건비 대상 아님, 간접비 현금·고시비율 10% 이내)
  const RULESETS = {
    sme: { label: '중소기업', govMaxPct: 75, cashMinPct: 10, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 75% 이하', cash: '시행령 별표 1 제2호: 기관부담금의 10% 이상 현금', indirect: '사용 기준 제114조④: 영리기관 간접비고시비율 10%' } },
    midS: { label: '중견기업(평균매출액등 3천억 원 미만)', govMaxPct: 70, cashMinPct: 10, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 70% 이하', cash: '시행령 별표 1 제2호 나목: 3천억 원 미만 중견 10% 이상 현금', indirect: '사용 기준 제114조④: 영리기관 10%' } },
    midL: { label: '중견기업(평균매출액등 3천억 원 이상)', govMaxPct: 70, cashMinPct: 13, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 70% 이하', cash: '시행령 별표 1 제2호: 중견기업 13% 이상 현금', indirect: '사용 기준 제114조④: 영리기관 10%' } },
    large: { label: '대기업·공기업', govMaxPct: 50, cashMinPct: 15, indirectPct: 10, indirectMax: 10, profit: true,
      basis: { gov: '시행령 별표 1 제1호: 정부지원 50% 이하', cash: '시행령 별표 1 제2호: 공기업·대기업 15% 이상 현금', indirect: '사용 기준 제114조④: 영리기관(공기업 포함) 10%' } },
    univ: { label: '대학', govMaxPct: 100, cashMinPct: 0, indirectPct: 5, indirectMax: 100, profit: false,
      basis: { gov: '시행령 제19조①: 비영리기관은 기관부담 의무 없음', cash: '기관부담 의무 없음', indirect: '사용 기준 제114조③: 고시비율 없는 대학 5%(고시비율 있으면 그 비율 입력)' } },
    nonprofit: { label: '비영리기관(대학 외)', govMaxPct: 100, cashMinPct: 0, indirectPct: 17, indirectMax: 100, profit: false,
      basis: { gov: '시행령 제19조①: 비영리기관은 기관부담 의무 없음', cash: '기관부담 의무 없음', indirect: '사용 기준 제114조③: 고시비율 없는 비영리기관 17%(고시비율 있으면 그 비율 입력)' } },
    custom: { label: '공고문 기준 직접 입력', govMaxPct: 75, cashMinPct: 10, indirectPct: 10, indirectMax: 100, profit: true, custom: true,
      basis: { gov: '공고문·운영요령 기준', cash: '공고문·운영요령 기준', indirect: '기관 간접비 고시비율' } },
  };

  // 공통 한도(사용 기준)
  const LIMITS = { extTechPct: 40,
    allowancePct: 20, // 제26조①: 수정인건비(현물 포함 인건비+학생인건비)의 20% 이내
    outsourcePct: 40, // 제27조①: (직접비 − 위탁 − 국제공동 − 연구개발부담비)의 40% 이하
    execDeviationPct: 25, // 집행 현황판: 경과율 대비 부진·과속 기준(%p)
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

  // 인력 구분(사용 기준 제65조④): 기존 인력=현물 원칙, 신규 채용=현금, 부처 인정 시 기존 인력 현금
  // 세부 비목(세목). 사용 기준 제8조(연구시설·장비비)·제9조(연구재료비)·제10조(연구활동비)의 사용용도 구분.
  // inkind: 현물 계상 가능(시행령 별표 1 제3호), ext: 외부 전문기술 활용비(직접비의 40% 범위, 제25조②), unit: 건별 금액으로 보는 항목
  const SUBITEMS = {
    equipment: [
      { k: 'buy', label: '구입·설치비', inkind: true, unit: true },
      { k: 'rent', label: '임차비' },
      { k: 'run', label: '운영·유지비' },
    ],
    material: [
      { k: 'buy', label: '연구재료 구입비', inkind: true },
      { k: 'make', label: '연구재료 제작비(시험제품·시험설비)', inkind: true },
      { k: 'mgmt', label: '연구개발과제 관리비' },
    ],
    activity: [
      { k: 'ip', label: '지식재산 창출 활동비' },
      { k: 'techin', label: '외부 전문기술 활용비 — 기술도입비', ext: true, inkind: true },
      { k: 'expert', label: '외부 전문기술 활용비 — 전문가 활용비', ext: true },
      { k: 'rnds', label: '외부 전문기술 활용비 — 연구개발서비스 활용비', ext: true },
      { k: 'meeting', label: '회의비' },
      { k: 'travel', label: '출장비' },
      { k: 'sw', label: '소프트웨어 활용비', inkind: true },
      { k: 'cloud', label: '클라우드컴퓨팅서비스 활용비' },
      { k: 'lab', label: '연구실운영비' },
      { k: 'people', label: '연구인력 지원비' },
      { k: 'invite', label: '해외 연구자 유치 지원비' },
      { k: 'etc', label: '그 밖의 비용' },
    ],
  };
  const MAX_SUB = 30;
  const subType = (key, t) => (SUBITEMS[key] || []).find((x) => x.k === t) || null;
  const hasSub = (key, v) => !!SUBITEMS[key] && !!v && Array.isArray(v.sub) && v.sub.length > 0;
  /** 비목 금액: 세부 내역이 있으면 그 합계, 없으면 직접 입력값 */
  function itemAmounts(key, v, allowInkind) {
    if (hasSub(key, v)) {
      let cash = 0, inkind = 0;
      for (const r of v.sub) { const t = subType(key, r.t); cash += int(r.cash); if (t && t.inkind) inkind += int(r.inkind); }
      return { cash, inkind, sub: true };
    }
    return { cash: int(v && v.cash), inkind: allowInkind ? int(v && v.inkind) : 0, sub: false };
  }
  /** 세부 내역이 있는 비목의 합계를 목표값으로 맞춤(자동 고치기용): 늘릴 땐 첫 행에 더하고, 줄일 땐 뒤 행부터 줄임 */
  function setItemTotal(key, v, side, value) {
    if (!hasSub(key, v)) { v[side] = String(value); return; }
    const rows = v.sub.filter((r) => side === 'cash' || (subType(key, r.t) || {}).inkind);
    let diff = int(value) - rows.reduce((a, r) => a + int(r[side]), 0);
    if (diff > 0) { const r = rows[0] || v.sub[0]; r[side] = String(int(r[side]) + diff); return; }
    for (let i = rows.length - 1; i >= 0 && diff < 0; i--) { const cut = Math.min(int(rows[i][side]), -diff); rows[i][side] = String(int(rows[i][side]) - cut); diff += cut; }
  }
  // 소관 부처·사업 유형 프리셋(features.ministry). 원문으로 확인한 차이만 반영(2026-11-17 조회).
  // rates: 기관 유형별 [정부지원 상한 %, 기관부담 중 현금 최소 %] — 시행령 별표 1과 다른 경우만. 나머지는 법령 기준 + 안내 문구
  const MINISTRIES = {
    common: { label: '공통(시행령·사용 기준 고시)', src: '', notes: [] },
    motie1: { label: '산업부 — 원천기술형', src: '산업기술혁신사업 공통 운영요령 제24조②·제25조④(고시 제2024-218호, 2024.12.30.)',
      notes: ['정부지원·현금 비율은 시행령 기준과 같습니다(대기업 50%·중견 70%·중소 75%).', '위탁연구개발비 비목이 없습니다. 외주 용역은 연구활동비(외부 전문기술 활용비, 직접비의 40% 범위)로 편성합니다(별표 5).', '기존 인력 인건비는 현물이 원칙이고, 신규 채용·창업 7년 이내 중소기업·인건비 현금 인정 분야 등만 현금 계상합니다(별표 5).', '기술도입비는 총 연구개발비의 30%(해외 기술 50%) 이내입니다(별표 5).', '기반조성·인력·국제협력 등은 공고에서 비율을 달리 정합니다(제24조③).'] },
    motie2: { label: '산업부 — 혁신제품형', src: '산업기술혁신사업 공통 운영요령 제24조②(혁신제품형)·제25조④(고시 제2024-218호, 2024.12.30.)',
      rates: { sme: [67, 10], midS: [50, 10], midL: [50, 13], large: [33, 15] },
      notes: ['정부지원 상한이 낮습니다: 대기업 33%·중견 50%·중소 67%(제24조② 표).', '수요기업·소부장 핵심전략기술 참여기업·평균매출액등 3천억 원 미만 중견기업은 중소기업 수준을 적용할 수 있습니다(공고 확인).', '위탁연구개발비 비목이 없습니다. 외주 용역은 연구활동비(외부 전문기술 활용비)로 편성합니다(별표 5).', '기존 인력 인건비는 현물이 원칙입니다(별표 5).'] },
    mss: { label: '중기부', src: '중소기업기술개발 지원사업 운영요령 제18조·제19조(고시 제2026-6호, 2026.1.21.)',
      notes: ['중소기업 정부지원 75% 이하·현금 10% 이상으로 시행령 기준과 같습니다(제18조②③).', '세부사업별 지원 비율·분담 방식은 사업 공고·관리지침에서 따로 정합니다(예: 수요처 분담이 있는 사업). 공고문을 꼭 확인하세요.', '자체 재원으로 고용한 연구자 인건비는 현물이 원칙이고, 신규 채용 등 장관이 인정한 경우만 현금입니다(제18조③④).'] },
    msit: { label: '과기정통부 — 과학기술분야', src: '과학기술정보통신부 과학기술분야 연구개발사업처리규정 제18조(훈령 제325호, 2026.9.18.)',
      notes: ['별도 수치 없이 시행령·사용 기준 고시를 그대로 따릅니다(제18조⑧).', '과제 제안요구서(RFP)에서 지원 비율·간접비를 조정한 경우 그 값을 따릅니다(제18조①). 기초연구는 더 높게 지원할 수 있습니다.'] },
    ict: { label: '과기정통부 — ICT(정보통신·방송)', src: '정보통신·방송 연구개발 관리규정 별표 4(고시 제2025-22호, 2025.5.13.)',
      notes: ['정부지원·현금 비율은 시행령 기준과 같습니다(별표 4 제1·2호).', '신규 채용 인건비가 인건비 총액의 30% 이상이면 같은 금액만큼 기존 인력도 현금 계상할 수 있습니다(제26조②).', '공개SW·소부장·수요기업 과제는 공고에서 특례를 정합니다.'] },
    ictv: { label: '과기정통부 — ICT 바우처 사업', src: '정보통신·방송 연구개발 관리규정 별표 4 제3호(고시 제2025-22호, 2025.5.13.)',
      rates: { sme: [75, 5], midS: [70, 6.5], midL: [70, 6.5] },
      notes: ['현금 부담이 절반입니다: 중소 5%·중견 6.5% 이상(별표 4 제3호).', '정부지원은 중소 75%·중견 70% 이내입니다.'] },
  };
  /** 부처 프리셋이 정한 비율(없으면 null = 법령 기준 그대로) */
  const ministryRates = (key, legalType) => { const m = MINISTRIES[key]; const r = m && m.rates && m.rates[legalType]; return r ? { govMaxPct: r[0], cashMinPct: r[1] } : null; };
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

  const UNIT_WARN = { gov: 10000000, salary: 1000000 }; // 정부출연금 100억 원·연봉 10억 원 이상이면 단위 착오 의심
  const DEFAULT_RULES = { indirectPct: 10, allowanceMaxPct: LIMITS.allowancePct };

  const int = (v) => {
    const n = Math.round(Number(String(v ?? '').replace(/[,\s]/g, '')));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const pct = (v, max = 100) => {
    const n = Number(String(v ?? '').replace(/[,%\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };
  /** 금액 입력 해석 → 천원. "5억", "1억 5천만원", "300백만", "500,000,000원"(원 단위 표기) 지원. 단위 글자가 없으면 천원으로 봄 */
  function parseAmount(v) {
    const t = String(v ?? '').replace(/[\s,]/g, '');
    if (!t) return 0;
    if (/[억만천백]|원$/.test(t)) {
      let total = 0, m; const U = { 억: 100000, 천만: 10000, 백만: 1000, 만: 10 };
      const re = /(\d+(?:\.\d+)?)(억|천만|백만|만)/g; let last = 0, hit = false;
      while ((m = re.exec(t))) { total += Number(m[1]) * U[m[2]]; last = re.lastIndex; hit = true; }
      const rest = t.slice(last);
      const thou = rest.match(/^(\d+)천원$/); const won = rest.match(/^(\d+)원$/);
      if (thou) total += Number(thou[1]); else if (won) total += Number(won[1]) / 1000; else if (!hit) return int(t);
      return Math.max(0, Math.round(total));
    }
    return int(t);
  }
  /** 천원 → 읽기 쉬운 원 단위 표기(예: 300000 → "3억 원", 1250 → "125만 원") */
  function wonText(k) {
    const won = int(k) * 1000;
    if (!won) return '';
    const jo = Math.floor(won / 1e12), eok = Math.floor((won % 1e12) / 1e8), man = Math.floor((won % 1e8) / 1e4), rest = won % 1e4;
    const parts = [];
    if (jo) parts.push(`${jo.toLocaleString('ko-KR')}조`);
    if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`);
    if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
    if (rest) parts.push(`${rest.toLocaleString('ko-KR')}`);
    return parts.join(' ') + ' 원';
  }
  const personKind = (p) => (p.kind && PERSON_KINDS[p.kind] ? p.kind : p.inkind ? 'existing' : 'new');

  /** 적용 비율: 법령 유형이면 고정값(간접비만 상한 내 조정), 직접 입력이면 사용자 값 */
  function effectiveRules(s) {
    const rs = RULESETS[s.ruleset] || RULESETS.sme;
    if (rs.custom) {
      return { ...rs, govMaxPct: pct(s.govMaxPct), cashMinPct: pct(s.cashMinPct), indirectPct: s.indirectPct === undefined || s.indirectPct === '' ? rs.indirectPct : pct(s.indirectPct), allowancePct: s.allowanceMaxPct === undefined || s.allowanceMaxPct === '' ? LIMITS.allowancePct : pct(s.allowanceMaxPct), outsourcePct: s.outsourceMaxPct === undefined || s.outsourceMaxPct === '' ? LIMITS.outsourcePct : pct(s.outsourceMaxPct) };
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
      const amt = itemAmounts(it.key, v, it.inkind);
      let cash = amt.cash, inkind = amt.inkind;
      if (it.key === 'personnel') {
        cash = people.filter((p) => !p.inkind).reduce((a, p) => a + p.cost, 0);
        inkind = people.filter((p) => p.inkind).reduce((a, p) => a + p.cost, 0);
      }
      return { key: it.key, label: it.label, cash, inkind, total: cash + inkind, sub: amt.sub };
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
    const checks = runChecks({ s, rules, funding, get, direct, total, people, indirectBase, indirectPct, outsource, items: s.items || {} });
    return { rules, funding, people, rows, direct, indirectBase, indirect, total, checks };
  }

  function runChecks({ rules, funding, get, direct, total, people, indirectBase, indirectPct, outsource, items = {} }) {
    const out = [];
    const add = (level, msg, basis, code, ref) => out.push({ level, msg, basis: basis || '', code: code || '', ref }); // code: 도우미 '고치기' 연결용
    const fmt = (n) => n.toLocaleString('ko-KR');
    const gov = funding.gov;
    if (rules.custom && !(rules.govMaxPct > 0)) { add('error', '공고문 기준 직접 입력: 정부지원 비율 상한(%)을 입력하세요. 0이거나 비어 있으면 점검할 수 없습니다.', '', 'govmax'); return out; }
    const wonOf = (k) => wonText(k);
    if (gov >= UNIT_WARN.gov) add('warn', `정부출연금 ${fmt(gov)}천원은 ${wonOf(gov)}입니다. 원 단위로 입력하지 않았는지 확인하세요(이 도구의 단위는 천원).`, '', 'unit-gov');
    people.forEach((p, i) => { if (int(p.salary) >= UNIT_WARN.salary) add('warn', `${p.name || '이름 없음'}: 연봉 ${fmt(int(p.salary))}천원은 ${wonOf(int(p.salary))}입니다. 원 단위로 입력하지 않았는지 확인하세요.`, '', 'unit-salary', i); });
    if (!gov) { add('info', '정부출연금(정부지원연구개발비)을 입력하면 기관부담금과 편성 점검 결과가 표시됩니다.'); return out; }
    if (!total.total) { add('info', `최소 총사업비 ${fmt(funding.total)}천원에 맞춰 비목을 편성하세요.`); return out; }

    const { govMaxPct, cashMinPct } = rules;
    const govShare = (gov / total.total) * 100;
    if (total.total < funding.total) add('error', `총사업비가 최소 총사업비보다 ${fmt(funding.total - total.total)}천원 부족합니다(정부지원 비율 ${govShare.toFixed(1)}% > ${govMaxPct}%).`, rules.basis.gov, 'total');
    else add('ok', `총사업비 ${fmt(total.total)}천원 — 정부지원 비율 ${govShare.toFixed(1)}%(한도 ${govMaxPct}%).`, rules.basis.gov);

    const org = total.total - gov;
    const orgCash = total.cash - gov;
    if (orgCash < 0) add('error', `현금 편성 ${fmt(total.cash)}천원이 정부출연금보다 ${fmt(-orgCash)}천원 적습니다. 정부출연금은 전액 현금 비목으로 편성해야 합니다.`, '', 'cash');
    else if (org > 0 && cashMinPct > 0) {
      const need = Math.ceil((org * cashMinPct) / 100);
      if (orgCash < need) add('error', `기관부담금 중 현금 ${fmt(orgCash)}천원 — 최소 ${fmt(need)}천원(${cashMinPct}%)보다 ${fmt(need - orgCash)}천원 부족합니다. 현금 비목(연구재료비·연구활동비 등)을 늘리거나 현물을 줄이세요.`, rules.basis.cash, 'cash');
      else add('ok', `기관부담금 ${fmt(org)}천원 = 현금 ${fmt(orgCash)} + 현물 ${fmt(total.inkind)}(현금 ${((orgCash / org) * 100).toFixed(1)}%, 최소 ${cashMinPct}%).`, rules.basis.cash);
    }

    // 연구수당: 수정인건비(현물 포함 인건비 + 학생인건비)의 20% 이내
    const personnel = get('personnel').total + get('student').total;
    const allowance = get('allowance').total;
    const allowanceMax = Math.floor((personnel * rules.allowancePct) / 100);
    if (allowance > allowanceMax) add('error', `연구수당 ${fmt(allowance)}천원이 한도 ${fmt(allowanceMax)}천원(인건비·학생인건비의 ${rules.allowancePct}%)을 넘습니다.`, '사용 기준 제26조①', 'allowance');
    else if (allowance) add('ok', `연구수당 ${fmt(allowance)}천원 — 한도 ${fmt(allowanceMax)}천원 이내.`, '사용 기준 제26조①');

    // 위탁연구개발비: (직접비 − 위탁)의 40% 이하
    if (outsource) {
      const base = direct.total - outsource;
      const max = Math.floor((base * rules.outsourcePct) / 100);
      if (outsource > max) add('error', `위탁연구개발비 ${fmt(outsource)}천원이 한도 ${fmt(max)}천원((직접비 − 위탁) ${fmt(base)}의 ${rules.outsourcePct}%)을 넘습니다. 부처가 인정한 경우만 초과 가능.`, '사용 기준 제27조①', 'outsource');
      else add('ok', `위탁연구개발비 ${fmt(outsource)}천원 — 한도 ${fmt(max)}천원 이내.`, '사용 기준 제27조①');
    }

    // 비영리기관: 정부출연금을 넘는 편성은 기관 자체 부담
    if (!rules.profit && !rules.custom && total.total > gov) {
      const over = total.total - gov, rate = rules.indirectPct;
const fit = Math.ceil((gov * 100) / (100 + rate));
      if (over <= 1) add('info', `간접비 반올림으로 총사업비가 정부출연금보다 ${fmt(over)}천원 많습니다. 계획서 시스템 금액에 맞춰 1천원 단위로 조정하세요.`, '', 'np-round');
      else add('warn', `총사업비가 정부출연금보다 ${fmt(over)}천원 많습니다. 기관부담 의무는 없으므로 초과분은 기관이 자체 부담(현금 ${fmt(Math.max(0, total.cash - gov))}·현물 ${fmt(total.inkind)})하게 됩니다. 출연금에 맞추려면 직접비(현금)를 ${fmt(fit)}천원으로 편성하세요(간접비 ${rate}% 포함 기준, 반올림으로 1천원 차이는 날 수 있음).`, rules.basis.gov, 'np-over');
    }
    for (const p of people) {
      const name = p.name || '이름 없음';
      if (int(p.months) > 12) add('warn', `${name}: 참여개월 ${int(p.months)} → 한 연차는 12개월까지라 12개월로 계산했습니다.`);
      const rr = Number(String(p.rate ?? '').replace(/[,%\s]/g, ''));
      if (rr > 0 && rr < 1) add('warn', `${name}: 참여율 ${rr}% — 30%라면 0.3이 아니라 30으로 입력하세요.`);
      if (p.totalRate > LIMITS.rateMax) add('error', `${name}: 총 참여율 ${p.totalRate}%(이 과제 ${pct(p.rate, 1000)}% + 다른 과제 ${pct(p.otherRate, 1000)}%)가 100%를 넘습니다.`, '사용 기준 제65조⑦', 'rate', people.indexOf(p));
      if (p.cost === 0 && (p.name || p.salary)) add('warn', `${name}: 연봉·참여개월·참여율을 확인하세요(인건비 0).`);
      if (p.kind === 'existingCash' && rules.profit) add('warn', `${name}: 인건비 현금 계상은 신규 채용 인력 등 사용 기준이 정한 경우에만 가능합니다. 기존 인력을 현금으로 넣으려면 부처(전문기관) 인정이 필요합니다.`, '사용 기준 제65조④', 'kindcash', people.indexOf(p));
    }
    const equip = get('equipment').total;
    const eqV = items.equipment, acV = items.activity;
    if (hasSub('equipment', eqV)) { // 세부 내역이 있으면 구입·설치비 건별로 판단
      eqV.sub.filter((r) => r.t === 'buy').forEach((r) => {
        const a = int(r.cash) + int(r.inkind), nm = r.name ? `‘${r.name}’` : '구입·설치비';
        if (a >= 100000) add('warn', `장비 ${nm} ${fmt(a)}천원 — 1억 원 이상은 시설·장비 표준지침 절차(심의)를 따르고 ZEUS 공동활용 확인이 필요합니다.`, '사용 기준 제23조');
        else if (a >= 30000) add('warn', `장비 ${nm} ${fmt(a)}천원 — 3천만 원 이상은 ZEUS 공동활용 확인이 필요합니다.`, '사용 기준 제23조');
      });
    } else
    if (equip >= 30000) add('warn', `연구시설·장비비 ${fmt(equip)}천원 — 3천만 원 이상 장비는 ZEUS 공동활용 확인이 필요하고, 1억 원 이상은 시설·장비 표준지침 절차를 따릅니다(장비 1건 기준).`, '사용 기준 제23조');
    if (hasSub('activity', acV)) {
      const ext = acV.sub.reduce((a, r) => { const t = subType('activity', r.t); return a + (t && t.ext ? int(r.cash) + (t.inkind ? int(r.inkind) : 0) : 0); }, 0);
      const extMax = Math.floor((direct.total * LIMITS.extTechPct) / 100);
      if (ext > extMax) add('error', `외부 전문기술 활용비 ${fmt(ext)}천원이 한도 ${fmt(extMax)}천원(직접비 ${fmt(direct.total)}의 ${LIMITS.extTechPct}%)을 넘습니다. 부처가 인정한 경우만 초과 가능.`, '사용 기준 제25조②', 'exttech');
      else if (ext) add('ok', `외부 전문기술 활용비 ${fmt(ext)}천원 — 직접비의 ${LIMITS.extTechPct}% 한도(${fmt(extMax)}천원) 이내`, '사용 기준 제25조②');
    }
    for (const key of Object.keys(SUBITEMS)) {
      const v = items[key];
      if (hasSub(key, v) && v.sub.some((r) => !subType(key, r.t))) add('warn', `${(ITEMS.find((x) => x.key === key) || {}).label}: 세목을 고르지 않은 세부 행이 있습니다.`);
    }
    if (indirectBase && !indirectPct) add('warn', '간접비율이 0%입니다. 기관 고시 비율 또는 공고문 기준을 입력하세요.');
    add('info', `간접비 = 수정직접비(직접비 − 현물 − 위탁) ${fmt(indirectBase)}천원 × ${indirectPct}% = ${fmt(Math.floor((indirectBase * indirectPct) / 100))}천원(현금).`, rules.basis.indirect);
    return out;
  }

  // ---------- 과제(연차 × 기관) ----------
  // project v2: { v:2, title, years, insts:[{ name, role:'lead'|'joint', ruleset, govMaxPct, cashMinPct, indirectPct, allowanceMaxPct, data:[{gov, people, items}] }] }
  const MAX_YEARS = 5, MAX_INSTS = 10;
  const ROLES = { lead: '주관연구개발기관', joint: '공동연구개발기관' };
  const blankYear = () => ({ exec: blankExec(), gov: '', people: [{ name: '', salary: '', months: 12, rate: '', otherRate: '', kind: 'existing' }], items: {} });
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
    const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
    p.insts = (Array.isArray(p.insts) ? p.insts : []).filter(isObj).slice(0, MAX_INSTS);
    if (!p.insts.length) p.insts = [newInst('lead')];
    for (const inst of p.insts) {
      if (!RULESETS[inst.ruleset]) inst.ruleset = 'sme';
      if (inst.ministry !== undefined && !MINISTRIES[inst.ministry]) delete inst.ministry;
      if (!ROLES[inst.role]) inst.role = 'joint';
      inst.name = String(inst.name || '').slice(0, 40) || '기관';
      inst.data = Array.isArray(inst.data) ? inst.data.filter(isObj).slice(0, MAX_YEARS) : [];
      while (inst.data.length < p.years) inst.data.push(blankYear());
      for (const d of inst.data) {
        d.people = Array.isArray(d.people) ? d.people.filter(isObj).slice(0, 50) : [];
        d.items = isObj(d.items) ? Object.fromEntries(Object.entries(d.items).filter(([, v]) => isObj(v))) : {};
        for (const [k, v] of Object.entries(d.items)) { // 세부 내역 정리(형식이 어긋난 값 제거)
          if (v.sub === undefined) continue;
          if (!SUBITEMS[k] || !Array.isArray(v.sub)) { delete v.sub; continue; }
          v.sub = v.sub.filter(isObj).slice(0, MAX_SUB).map((r) => ({ t: subType(k, r.t) ? r.t : '', name: String(r.name ?? '').slice(0, 40), cash: r.cash ?? '', inkind: r.inkind ?? '' }));
          if (!v.sub.length) delete v.sub;
        }
        d.exec = normalizeExec(d.exec);
      }
    }
    return p;
  }

  /** 한 기관·한 연차의 계산용 상태(calcBudget 입력) */
  function sheetState(p, i, y) {
    const inst = p.insts[i], d = inst.data[y];
    return { ruleset: inst.ruleset, govMaxPct: inst.govMaxPct, cashMinPct: inst.cashMinPct, indirectPct: inst.indirectPct, allowanceMaxPct: inst.allowanceMaxPct, outsourceMaxPct: inst.outsourceMaxPct, gov: d.gov, people: d.people, items: d.items };
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
        // 정부지원은 현금 편성액 범위까지만 집계(현금이 정부출연금보다 적게 편성된 경우 합계가 실제 편성액과 어긋나지 않게)
        const govIn = Math.min(gov, r.total.cash);
        r.sum = { gov: govIn, orgCash: Math.max(0, r.total.cash - gov), inkind: r.total.inkind, total: r.total.total, govPlan: gov };
        r.errors = r.checks.filter((c) => c.level === 'error').length;
        years.push(r);
      }
      return { name: inst.name, role: inst.role, rules: years[0].rules, years, total: sumT(years.map((r) => r.sum)) };
    });
    const yearTotals = Array.from({ length: p.years }, (_, y) => sumT(insts.map((it) => it.years[y].sum)));
    const total = sumT(yearTotals);
    const empty = [];
    insts.forEach((it) => it.years.forEach((r, y) => { if (!r.funding.gov && !r.total.total) empty.push(`${it.name} ${y + 1}차년도`); }));
    const checks = [];
    const leads = p.insts.filter((x) => x.role === 'lead').length;
    // 주관기관이 없는 구성(참여기관만 편성)은 허용. 2곳 이상일 때만 안내
    if (leads > 1) checks.push({ level: 'warn', msg: `주관연구개발기관은 1곳이어야 합니다(현재 ${leads}곳).` });
    const errs = insts.reduce((a, it) => a + it.years.reduce((b, r) => b + r.errors, 0), 0);
    if (errs) checks.push({ level: 'error', msg: `기관·연차별 편성에 오류 ${errs}건이 있습니다. 총괄표에서 ✖ 표시된 칸을 눌러 확인하세요.` });
    else if (total.gov && !empty.length) checks.push({ level: 'ok', msg: '모든 기관·연차 편성이 점검을 통과했습니다.' });
    if (total.gov && empty.length) checks.push({ level: 'warn', code: 'empty', msg: `아직 편성하지 않은 칸이 ${empty.length}곳 있습니다(${empty.slice(0, 4).join(', ')}${empty.length > 4 ? ' 등' : ''}). 편성이 없는 연차라면 연구개발기간을 줄이세요.` });
    return { project: p, insts, yearTotals, total, checks, empty };
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

  const esc = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  // 엑셀 안에 편성 데이터를 숨김 시트로 함께 저장 → 이 파일을 다시 올리면 이어서 작업(엑셀에서 고친 값은 반영되지 않음)
  const DATA_SHEET = '_rndbudget', DATA_MAGIC = 'RNDBUDGET1';
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64encode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
    }
    return out;
  }
  function b64decode(str) {
    const t = String(str).replace(/[^A-Za-z0-9+/]/g, ''), out = new Uint8Array(Math.floor((t.length * 3) / 4));
    let n = 0;
    for (let i = 0; i < t.length; i += 4) {
      const v = [0, 1, 2, 3].map((k) => (i + k < t.length ? B64.indexOf(t[i + k]) : -1));
      out[n++] = (v[0] << 2) | (v[1] >> 4);
      if (v[2] >= 0) out[n++] = ((v[1] & 15) << 4) | (v[2] >> 2);
      if (v[3] >= 0) out[n++] = ((v[2] & 3) << 6) | v[3];
    }
    return out.subarray(0, n);
  }
  function dataSheet(project, savedAt) {
    const b64 = b64encode(new TextEncoder().encode(JSON.stringify({ app: 'rnd-budget', v: 3, savedAt, project })));
    const rows = [[DATA_MAGIC], ['이 시트는 편성 도구가 이 파일을 다시 불러올 때 쓰는 데이터입니다. 지우거나 고치지 마세요.']];
    for (let i = 0; i < b64.length; i += 30000) rows.push([b64.slice(i, i + 30000)]);
    return { name: DATA_SHEET, rows, hidden: true };
  }
  /** 숨김 시트의 A열 문자열 목록(위에서부터) → 백업 객체. 형식이 다르면 null */
  function parseDataCells(cells) {
    if (!Array.isArray(cells) || cells[0] !== DATA_MAGIC) return null;
    try {
      const obj = JSON.parse(new TextDecoder().decode(b64decode(cells.slice(2).join(''))));
      return obj && obj.app === 'rnd-budget' && obj.project ? obj : null;
    } catch { return null; }
  }

  /** 편성표 XLSX(합계는 엑셀 수식) */
  const RB_KIND_LABEL = (p) => PERSON_KINDS[personKind(p)].label;
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EFFF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6"><xf/><xf numFmtId="3" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/><xf borderId="1" applyBorder="1"/><xf numFmtId="3" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  // 스타일 번호: 1 숫자, 2 굵게, 3 테두리, 4 테두리+숫자, 5 표 머리(굵게·배경·테두리)
  const sheetName = (s, used) => {
    let n = String(s).replace(/[\[\]:*?\/\\\x00-\x1F]/g, ' ').trim().replace(/^'+|'+$/g, '').trim().slice(0, 28).replace(/'+$/, '') || '시트';
    let k = n, i = 2;
    while (used.has(k)) k = `${n.slice(0, 26)}(${i++})`;
    used.add(k);
    return k;
  };

  function workbook(sheets) {
    const n = sheets.length;
    const ct = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const wbSheets = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="veryHidden"' : ''} r:id="rId${i + 1}"/>`).join('');
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
  function buildXlsx(raw, opts = {}) {
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
    const under = P.insts.some((it) => it.years.some((r) => r.sum.govPlan > r.sum.gov));
    if (under) t1.push([], ['⚠ 현금 편성액이 정부지원연구개발비보다 적은 기관·연차가 있습니다. 정부지원연구개발비 칸은 편성된 금액만 표시됩니다(미편성분 제외).']);
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
    // 세부 내역(세목을 입력한 비목이 있을 때만)
    const t6 = [];
    p.insts.forEach((inst) => inst.data.slice(0, p.years).forEach((d, y) => {
      for (const key of Object.keys(SUBITEMS)) {
        const v = (d.items || {})[key]; if (!hasSub(key, v)) continue;
        const lab = (ITEMS.find((x) => x.key === key) || {}).label;
        for (const r of v.sub) { const t = subType(key, r.t), n = t6.length + 5; t6.push([txt(inst.name), txt(yl(y)), txt(lab), txt(t ? t.label : '(세목 미선택)'), txt(r.name || ''), num(int(r.cash)), num(t && t.inkind ? int(r.inkind) : 0), f(`F${n}+G${n}`)]); }
      }
    }));
    if (t6.length) {
      const end = t6.length + 4;
      sheets.push({ name: sheetName('세부 내역', used), widths: [22, 10, 18, 40, 30, 15, 15, 16],
        rows: [[{ v: `${title} — 비목별 세부 내역`, s: B }], ['단위: 천원 · 세목 구분은 연구개발비 사용 기준 제8~10조'], [], head('기관명', '연차', '비목', '세목', '내용', '현금', '현물', '합계'), ...t6,
          [{ v: '합계', s: B }, '', '', '', '', f(`SUM(F5:F${end})`), f(`SUM(G5:G${end})`), f(`SUM(H5:H${end})`)]] });
    }
    // ⑤ 점검 결과(다운로드 시점)
    const LV = { error: '오류', warn: '주의', ok: '통과', info: '안내' };
    const t5 = [[{ v: `${title} — 점검 결과(다운로드 시점)`, s: B }], ['엑셀에서 금액을 고치면 이 시트는 자동으로 바뀌지 않습니다. 도구에서 다시 점검하세요.'], [], head('기관명', '연차', '구분', '내용', '근거')];
    let nErr = 0;
    P.insts.forEach((it) => it.years.forEach((r, y) => r.checks.filter((c) => c.level !== 'info').forEach((c) => { if (c.level === 'error') nErr++; t5.push([txt(it.name), txt(yl(y)), txt(LV[c.level]), txt(c.msg), txt(c.basis || '')]); })));
    t5.splice(2, 0, [nErr ? `⚠ 오류 ${nErr}건이 있는 상태로 내려받았습니다.` : '✔ 오류 없음']);
    sheets.push({ name: sheetName('점검 결과', used), rows: t5, widths: [24, 10, 8, 100, 40] });
    sheets.push(dataSheet(p, opts.savedAt || ''));
    return workbook(sheets);
  }

  // ---------- 집행 현황판(A1) ----------
  // data[y].exec = { start, end, cashDue, agreed:{key:cash}, monthly:{key:[12]}, paid:[{date, amount}] }
  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const dnum = (s) => Date.parse(s + 'T00:00:00Z') / 86400000;
  const ymdAddMonths = (s, n) => {
    const d = new Date(s + 'T00:00:00Z'); const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  };
  const blankExec = () => ({ start: '', end: '', cashDue: '', agreed: {}, monthly: {}, paid: [] });
  function normalizeExec(e) {
    const x = e && typeof e === 'object' ? e : {};
    return {
      start: isYmd(x.start) ? x.start : '', end: isYmd(x.end) ? x.end : '', cashDue: isYmd(x.cashDue) ? x.cashDue : '',
      agreed: x.agreed && typeof x.agreed === 'object' && !Array.isArray(x.agreed) ? x.agreed : {},
      monthly: x.monthly && typeof x.monthly === 'object' && !Array.isArray(x.monthly) ? Object.fromEntries(Object.entries(x.monthly).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.slice(0, 12)])) : {},
      paid: Array.isArray(x.paid) ? x.paid.filter((q) => q && typeof q === 'object').slice(0, 100) : [],
    };
  }
  /** 시작일 변경 시 월별 금액을 달력 월 기준으로 유지하도록 이동. 반환: { monthly, dropped(범위 밖으로 밀려 사라지는 금액 합) } */
  function shiftMonthly(monthly, oldStart, newStart) {
    if (!isYmd(oldStart) || !isYmd(newStart)) return { monthly, dropped: 0 };
    const mi = (d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
    const diff = mi(newStart) - mi(oldStart);
    if (!diff) return { monthly, dropped: 0 };
    const out = {}; let dropped = 0;
    for (const [k, arr] of Object.entries(monthly || {})) {
      const n = [];
      (Array.isArray(arr) ? arr : []).slice(0, 12).forEach((v, idx) => { const t = idx - diff; if (int(v)) { if (t >= 0 && t < 12) n[t] = v; else dropped += int(v); } });
      out[k] = Array.from({ length: 12 }, (_, x) => n[x] ?? '');
    }
    return { monthly: out, dropped };
  }
  /** 연차 시작월부터 12개월 라벨(예: '2026-04') */
  function execMonths(start) {
    if (!isYmd(start)) return [];
    return Array.from({ length: 12 }, (_, k) => ymdAddMonths(start.slice(0, 8) + '01', k).slice(0, 7));
  }

  /**
   * 한 기관·연차의 집행 현황. today: 기준일(YYYY-MM-DD)
   * 반환: { ready, months, elapsedPct, days, rows:[{key,label,plan,agreed,spent,remain,rate,status}], total, org, schedule, checks }
   */
  function calcExecution(raw, i, y, today, endOfProject) {
    const p = normalizeProject(raw);
    const plan = calcBudget(sheetState(p, i, y));
    const ex = normalizeExec(p.insts[i].data[y].exec);
    const dev = LIMITS.execDeviationPct;
    const ready = isYmd(ex.start) && isYmd(ex.end) && ex.end >= ex.start;
    const totalDays = ready ? dnum(ex.end) - dnum(ex.start) + 1 : 0;
    const passed = ready ? Math.min(totalDays, Math.max(0, dnum(today) - dnum(ex.start) + 1)) : 0;
    const elapsedPct = ready ? Math.round((passed / totalDays) * 1000) / 10 : 0;
    const rows = plan.rows.filter((r) => r.cash > 0 || int(ex.agreed[r.key]) || (ex.monthly[r.key] || []).some((v) => int(v))).map((r) => {
      const agreed = String(ex.agreed[r.key] ?? '') !== '' ? int(ex.agreed[r.key]) : r.cash;
      const spent = (ex.monthly[r.key] || []).slice(0, 12).reduce((a, v) => a + int(v), 0);
      const rate = agreed ? Math.round((spent / agreed) * 1000) / 10 : spent ? 999 : 0;
      let status = 'ok';
      if (spent > agreed) status = 'over';
      else if (ready && spent > 0 && rate > elapsedPct + dev && r.key !== 'personnel') status = 'fast';
      else if (ready && agreed > 0 && rate < elapsedPct - dev) status = 'slow';
      return { key: r.key, label: r.label, plan: r.cash, agreed, spent, remain: agreed - spent, rate, status };
    });
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const total = { agreed: sum('agreed'), spent: sum('spent'), remain: sum('remain') };
    total.rate = total.agreed ? Math.round((total.spent / total.agreed) * 1000) / 10 : 0;
    const orgPlan = Math.max(0, plan.total.cash - plan.funding.gov);
    const paid = ex.paid.reduce((a, x) => a + int(x.amount), 0);
    const cashDue = ex.cashDue || (ready ? ymdAddMonths(ex.end, -3) : '');
    const org = { plan: orgPlan, min: plan.funding.cashMin, paid, due: cashDue };

    const fmt = (n) => n.toLocaleString('ko-KR');
    const checks = [], schedule = [];
    const dd = (d) => dnum(d) - dnum(today);
    if (isYmd(ex.start) && isYmd(ex.end) && ex.end < ex.start) checks.push({ level: 'error', msg: `종료일(${ex.end})이 시작일(${ex.start})보다 빠릅니다. 연차 기간을 확인하세요.` });
    else if (!ready) checks.push({ level: 'info', msg: '연차 시작일·종료일(협약 기준)을 입력하면 경과율·기한이 계산됩니다.' });
    for (const r of rows) {
      if (r.status === 'over') checks.push({ level: 'error', msg: `${r.label} ${fmt(r.spent)}천원 — 협약액 ${fmt(r.agreed)}천원 초과(${fmt(-r.remain)}천원). 비목 간 변경(전문기관 승인 대상일 수 있음) 여부를 확인하세요.`, basis: r.key === 'allowance' ? '사용 기준 제26조' : '' });
      else if (r.status === 'slow') checks.push({ level: 'warn', msg: `${r.label} 집행률 ${r.rate}% — 경과율 ${elapsedPct}% 대비 부진(기준 ${dev}%p).` });
      else if (r.status === 'fast') checks.push({ level: 'warn', msg: `${r.label} 집행률 ${r.rate}% — 경과율 ${elapsedPct}% 대비 과속(기준 ${dev}%p). 일괄 구입·계약이면 정상.` });
    }
    if (ready && orgPlan > 0) {
      const left = orgPlan - paid, d = dd(cashDue);
      schedule.push({ label: '기관부담 현금 납부 기한', date: cashDue, dday: d, done: left <= 0 });
      if (left > 0) checks.push({ level: d < 0 ? 'error' : 'warn', msg: `기관부담 현금 ${fmt(left)}천원 미납 — 기한 ${cashDue}${ex.cashDue ? '(협약)' : '(연차 종료 3개월 전)'}${d < 0 ? ' 경과' : `, D-${d}`}.`, basis: '사용 기준 제60조②' });
    }
    const equip = rows.find((r) => r.key === 'equipment');
    const projEnd = isYmd(endOfProject) ? endOfProject : ready ? ex.end : '';
    if (ready && projEnd && equip && equip.agreed > 0) {
      const due = ymdAddMonths(projEnd, -2), d = dd(due);
      schedule.push({ label: '장비 구입 완료 기한(과제 종료 2개월 전)', date: due, dday: d, done: equip.spent >= equip.agreed });
      if (equip.spent < equip.agreed && d < 0) checks.push({ level: 'error', msg: `장비 구입 기한(${due}) 경과 — 미집행 ${fmt(equip.agreed - equip.spent)}천원.`, basis: '사용 기준 제23조' });
    }
    if (ready) {
      const d = dd(ex.end);
      schedule.push({ label: `${y + 1}차년도 종료`, date: ex.end, dday: d, done: d < 0 });
      if (d >= 0 && d <= 30 && total.remain > 0) checks.push({ level: 'warn', msg: `연차 종료 D-${d} — 잔액 ${fmt(total.remain)}천원. 이월·반납 기준은 사업별 운영요령을 확인하세요.` });
    }
    if (ready && rows.length && !checks.some((c) => c.level === 'error' || c.level === 'warn')) checks.push({ level: 'ok', msg: '초과·부진 비목이 없습니다.' });
    // 표시할 월 수: 연차 기간만큼(최대 12개월)
    const allMonths = execMonths(ex.start);
    const nMonths = ready ? Math.max(1, Math.min(12, allMonths.filter((m) => m <= ex.end.slice(0, 7)).length)) : 12;
    if (ready && execMonths(ex.start)[11] < ex.end.slice(0, 7)) checks.push({ level: 'info', msg: '연차 기간이 12개월을 넘습니다. 월별 입력은 시작월부터 12개월까지만 지원합니다.' });
    return { ready, nMonths, start: ex.start, end: ex.end, months: allMonths, elapsedPct, days: { passed, total: totalDays }, rows, total, org, schedule, checks, inkind: plan.total.inkind };
  }

  /** 집행 현황 엑셀: ① 비목별 현황(수식) ② 월별 집행 ③ 기관부담 현금 납부 ④ 점검 */
  function buildExecXlsx(raw, i, y, today, endOfProject) {
    const p = normalizeProject(raw);
    const E = calcExecution(p, i, y, today, endOfProject);
    const ex = normalizeExec(p.insts[i].data[y].exec);
    const N = 1, B = 2, T = 3, TN = 4, H = 5;
    const head = (...v) => v.map((x) => ({ v: x, s: H }));
    const num = (v) => ({ v, s: TN }), f = (x) => ({ f: x, s: TN }), txt = (v) => ({ v, s: T });
    const title = `${p.title || 'R&D 과제'} — ${p.insts[i].name} ${y + 1}차년도 집행 현황`;
    const t1 = [[{ v: title, s: B }], [`단위: 천원(현금) · 기준일 ${today} · 연차 ${E.start || '-'} ~ ${E.end || '-'} · 경과율 ${E.elapsedPct}%`], [],
      head('비목', '협약(현금)', '집행 누계', '잔액', '집행률(%)', '상태')];
    const st = { ok: '정상', over: '초과', slow: '부진', fast: '과속' };
    const s0 = t1.length + 1;
    E.rows.forEach((r) => { const n = t1.length + 1; t1.push([txt(r.label), num(r.agreed), num(r.spent), f(`B${n}-C${n}`), f(`IF(B${n}=0,0,ROUND(C${n}/B${n}*100,1))`), txt(st[r.status])]); });
    const e0 = t1.length, tn = e0 + 1;
    t1.push([{ v: '합계', s: H }, f(`SUM(B${s0}:B${e0})`), f(`SUM(C${s0}:C${e0})`), f(`SUM(D${s0}:D${e0})`), f(`IF(B${tn}=0,0,ROUND(C${tn}/B${tn}*100,1))`), txt('')]);
    t1.push([], [`현물 ${E.inkind.toLocaleString('ko-KR')}천원은 편성액 기준(집행 관리 대상 아님). 부진·과속 기준: 경과율 ±${LIMITS.execDeviationPct}%p.`]);
    const mlabels = E.months.length ? E.months : Array.from({ length: 12 }, (_, k) => `${k + 1}개월`);
    const t2 = [[{ v: '월별 집행(현금)', s: B }], ['단위: 천원'], [], head('비목', ...mlabels, '합계')];
    const m0 = t2.length + 1;
    E.rows.forEach((r) => {
      const n = t2.length + 1, vals = (ex.monthly[r.key] || []);
      t2.push([txt(r.label), ...Array.from({ length: 12 }, (_, k) => num(int(vals[k]))), f(`SUM(B${n}:M${n})`)]);
    });
    if (E.rows.length) { const n = t2.length + 1; t2.push([{ v: '합계', s: H }, ...Array.from({ length: 13 }, (_, k) => { const c = String.fromCharCode(66 + k); return f(`SUM(${c}${m0}:${c}${n - 1})`); })]); }
    const t3 = [[{ v: '기관부담 현금 납부', s: B }], [`계획 ${E.org.plan.toLocaleString('ko-KR')}천원 · 최소 ${E.org.min.toLocaleString('ko-KR')}천원 · 기한 ${E.org.due || '-'}`], [], head('납부일', '금액(천원)')];
    const p0 = t3.length + 1;
    ex.paid.filter((x) => int(x.amount)).forEach((x) => t3.push([txt(x.date || ''), num(int(x.amount))]));
    if (t3.length >= p0) t3.push([{ v: '합계', s: H }, f(`SUM(B${p0}:B${t3.length})`)]);
    const t4 = [[{ v: '점검·일정', s: B }], [], head('구분', '내용', '근거')];
    E.checks.forEach((c) => t4.push([txt({ error: '오류', warn: '주의', ok: '통과', info: '안내' }[c.level]), txt(c.msg), txt(c.basis || '')]));
    E.schedule.forEach((s) => t4.push([txt('일정'), txt(`${s.label}: ${s.date} (${s.dday >= 0 ? `D-${s.dday}` : `D+${-s.dday}`})`), txt('')]));
    t4.push([], ['※ 참고용입니다. 집행 기준은 사업별 운영요령·협약이 우선합니다.']);
    return workbook([
      { name: '집행 현황', rows: t1, widths: [20, 14, 14, 14, 12, 10] },
      { name: '월별 집행', rows: t2, widths: [18, ...Array(12).fill(10), 12] },
      { name: '기관부담 현금', rows: t3, widths: [16, 14] },
      { name: '점검·일정', rows: t4, widths: [8, 90, 22] },
    ]);
  }


  // ---------- 처음 편성 도우미(features.helper) ----------
  const ITEM_HELP = {
    personnel: '참여연구원 인건비. 2단계 표에서 자동 계산. 기존 인력은 현물, 신규 채용은 현금(사용 기준 제65조④).',
    student: '학생연구자 인건비(대학·연구기관만). 기업은 해당 없음.',
    equipment: '연구에 필요한 장비 구입·임차·제작비. 보유 장비는 구입가의 20% 이내 현물 가능. 3천만 원 이상은 ZEUS 공동활용 확인.',
    material: '시약·재료·시제품 제작 재료·소모품. 보통 현금 편성의 중심 비목이라 금액 조정에 가장 많이 씀.',
    outsource: '다른 기관에 맡기는 연구(위탁연구개발기관). (직접비 − 위탁)의 40% 이하.',
    activity: '출장·회의·전문가 활용·특허 출원·소프트웨어 활용 등 연구 활동 비용.',
    allowance: '연구 성과에 대한 보상(연구수당). 인건비(현물 포함)의 20% 이내, 1인 70% 초과 지급 불가.',
    indirect: '기관 운영 공통비용. 자동 계산 = (직접비 − 현물 − 위탁) × 간접비율, 현금.',
  };
  const DRAFT = { allowancePct: 10, activityPct: 5 }; // 초안 기본 배분: 연구수당 = 인건비의 10%, 연구활동비 = 목표 총사업비의 5%(조정 가능)

  /** 오류 없이 total·cash 조건을 맞추는 최소 연구재료비(현금) 찾기(이분 탐색) */
  function minMaterialCash(state) {
    const ok = (m) => { const mat = JSON.parse(JSON.stringify(state.items.material || {})); setItemTotal('material', mat, 'cash', m); const s = { ...state, items: { ...state.items, material: mat } }; return !calcBudget(s).checks.some((c) => c.code === 'total' || c.code === 'cash'); };
    const cur = itemAmounts('material', state.items.material || {}, true).cash;
    if (ok(cur)) return cur;
    let lo = cur, hi = Math.max(1000, cur * 2 + int(state.gov) * 3);
    for (let g = 0; g < 40 && !ok(hi); g++) hi *= 2;
    if (!ok(hi)) return null;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  /**
   * 질문 답변 → 편성 초안(한 기관·한 연차). answers:
   * { ruleset, gov, existing:{count, salary, rate}, hires:{count, salary, months}, equipCash, equipInkind, outsource }
   */
  function draftBudget(a) {
    const rules = effectiveRules({ ruleset: a.ruleset });
    const funding = calcFunding(a.gov, rules.govMaxPct, rules.cashMinPct);
    const people = [];
    const ex = a.existing || {}, hi = a.hires || {};
    for (let k = 0; k < Math.min(int(ex.count), 30); k++) people.push({ name: `기존연구원${k + 1}`, salary: String(int(ex.salary)), months: 12, rate: pct(ex.rate) || 30, otherRate: '', kind: rules.profit ? 'existing' : 'new' });
    for (let k = 0; k < Math.min(int(hi.count), 30); k++) people.push({ name: `신규연구원${k + 1}`, salary: String(int(hi.salary)), months: Math.min(int(hi.months) || 12, 12), rate: 100, otherRate: '', kind: 'new' });
    const personnel = people.reduce((s, p) => s + personCost(p), 0);
    const items = {
      equipment: { cash: String(int(a.equipCash)), inkind: rules.profit ? String(int(a.equipInkind)) : '' },
      outsource: { cash: String(int(a.outsource)) },
      ...(rules.profit ? {} : { student: { cash: String(int(a.student)) } }),
      allowance: { cash: String(Math.floor((personnel * DRAFT.allowancePct) / 100)) },
      activity: { cash: String(Math.round((funding.total * DRAFT.activityPct) / 100)) },
      material: { cash: '0' },
    };
    const state = { ruleset: a.ruleset, gov: String(int(a.gov)), people, items };
    const m = minMaterialCash(state);
    items.material.cash = String(m === null ? 0 : m);
    const result = calcBudget(state);
    const extra = [];
    if (funding.total > 0 && result.total.total > funding.total * 1.1) extra.push(`기존 인력 현물 등이 많아 총사업비가 최소 기준(${funding.total.toLocaleString('ko-KR')}천원)보다 ${(result.total.total - funding.total).toLocaleString('ko-KR')}천원 큽니다. 문제는 아니지만, 줄이려면 기존 인력의 참여율이나 현물 장비를 낮추세요.`);
    if (!people.length) extra.push('참여연구원을 입력하지 않았습니다. 인건비가 0으로 계산되니 2단계에서 추가하세요.');
    return { sheet: { gov: state.gov, people, items }, result, notes: [...extra, 
      `연구재료비 ${int(items.material.cash).toLocaleString('ko-KR')}천원은 최소 총사업비·현금 기준을 맞추기 위해 자동으로 채운 값입니다. 실제 필요 금액으로 나눠 조정하세요.`,
      `연구수당은 인건비의 ${DRAFT.allowancePct}%, 연구활동비는 총사업비의 ${DRAFT.activityPct}%로 넣었습니다.`,
    ] };
  }

  /** 점검 결과별 '이렇게 고치기' 제안. 반환: [{ code, label, ops }] — ops는 applyFix로 적용 */
  function suggestFixes(state) {
    const r = calcBudget(state);
    const fixes = [];
    const fmt = (n) => n.toLocaleString('ko-KR');
    const codes = new Set(r.checks.map((c) => c.code));
    if (codes.has('total') || codes.has('cash')) {
      const m = minMaterialCash(state), cur = itemAmounts('material', state.items.material || {}, true).cash;
      if (m !== null && m > cur) fixes.push({ code: codes.has('total') ? 'total' : 'cash', label: `연구재료비 현금 +${fmt(m - cur)}천원 → 총사업비·현금 기준 충족`, ops: [{ t: 'item', key: 'material', side: 'cash', value: m }] });
    }
    const get = (k) => r.rows.find((x) => x.key === k) || { total: 0, cash: 0 };
    if (codes.has('allowance')) {
      const max = Math.floor(((get('personnel').total + get('student').total) * r.rules.allowancePct) / 100);
      fixes.push({ code: 'allowance', label: `연구수당을 한도 ${fmt(max)}천원으로 낮추기`, ops: [{ t: 'item', key: 'allowance', side: 'cash', value: max }] });
    }
    if (codes.has('outsource')) {
      // 직접비 총액은 유지: 줄인 만큼 연구재료비로 옮김 → o' ≤ pct × (직접비 − o') 이므로 o' = ⌊직접비 × pct ÷ (100 + pct)⌋
      const o = get('outsource').total, p = r.rules.outsourcePct, max = Math.floor((r.direct.total * p) / (100 + p));
      const mat = itemAmounts('material', state.items.material || {}, true).cash + (o - max);
      fixes.push({ code: 'outsource', label: `위탁연구개발비 ${fmt(o - max)}천원을 연구재료비로 옮기기(위탁 ${fmt(max)}천원)`, ops: [{ t: 'item', key: 'outsource', side: 'cash', value: max }, { t: 'item', key: 'material', side: 'cash', value: mat }] });
    }
    for (const c of r.checks) {
      if (c.code === 'unit-gov') fixes.push({ code: 'unit-gov', label: `천원 단위로 바꾸기(÷1,000 → ${fmt(Math.round(int(state.gov) / 1000))}천원)`, ops: [{ t: 'gov', value: Math.round(int(state.gov) / 1000) }] });
      if (c.code === 'unit-salary' && Number.isInteger(c.ref)) { const p = state.people[c.ref]; fixes.push({ code: 'unit-salary', ref: c.ref, label: `${p.name || '연구원'} 연봉을 천원 단위로 바꾸기(÷1,000)`, ops: [{ t: 'person', index: c.ref, field: 'salary', value: Math.round(int(p.salary) / 1000) }] }); }
      if (c.code === 'rate' && Number.isInteger(c.ref) && pct(state.people[c.ref].otherRate, 1000) < 100) { const p = state.people[c.ref]; const v = Math.max(0, 100 - pct(p.otherRate, 1000)); fixes.push({ code: 'rate', ref: c.ref, label: `${p.name || '연구원'} 참여율을 ${v}%로 낮추기`, ops: [{ t: 'person', index: c.ref, field: 'rate', value: v }] }); }
      if (c.code === 'kindcash' && Number.isInteger(c.ref)) { const p = state.people[c.ref]; fixes.push({ code: 'kindcash', ref: c.ref, label: `${p.name || '연구원'}을 기존 인력(현물)로 바꾸기`, ops: [{ t: 'person', index: c.ref, field: 'kind', value: 'existing' }] }); }
    }
    return fixes;
  }
  /** 오류(error) 고치기를 오류가 없어질 때까지 반복 적용. 주의(warn) 항목은 그대로 둠 */
  function autoFix(sheet) {
    const ERR = new Set(['total', 'cash', 'allowance', 'outsource', 'rate']);
    let s = sheet; const applied = [], labels = [];
    for (let k = 0; k < 30; k++) {
      const errs = calcBudget(s).checks.filter((c) => c.level === 'error');
      if (!errs.length) break;
      const fx = suggestFixes(s).filter((f) => ERR.has(f.code));
      if (!fx.length) break;
      const key = JSON.stringify(fx[0].ops);
      if (applied.includes(key)) break; // 같은 수정 반복 → 중단
      s = { ...s, ...applyFix(s, fx[0]) }; applied.push(key); labels.push(fx[0].label);
    }
    return { sheet: s, applied: labels, remaining: calcBudget(s).checks.filter((c) => c.level === 'error').length };
  }
  /** 고치기 적용(원본 변경 없이 새 시트 반환) */
  function applyFix(sheet, fix) {
    const s = JSON.parse(JSON.stringify(sheet));
    for (const op of fix.ops) {
      if (op.t === 'item') { s.items[op.key] = s.items[op.key] || {}; setItemTotal(op.key, s.items[op.key], op.side, op.value); }
      if (op.t === 'gov') s.gov = String(op.value);
      if (op.t === 'person' && s.people[op.index]) s.people[op.index][op.field] = op.field === 'kind' ? op.value : String(op.value);
    }
    return s;
  }

  const RB = { MINISTRIES, ministryRates, DATA_SHEET, DATA_MAGIC, b64encode, b64decode, parseDataCells, SUBITEMS, MAX_SUB, subType, hasSub, itemAmounts, setItemTotal, UNIT_WARN, shiftMonthly, parseAmount, wonText, ITEM_HELP, DRAFT, minMaterialCash, draftBudget, suggestFixes, applyFix, autoFix, isYmd, ymdAddMonths, blankExec, normalizeExec, execMonths, calcExecution, buildExecXlsx, MAX_YEARS, MAX_INSTS, ROLES, blankYear, newInst, normalizeProject, sheetState, calcProject, splitCash, EXAMPLES, BASIS_DATE, SOURCES, RULESETS, LIMITS, ITEMS, PERSON_KINDS, DEFAULT_RULES, int, pct, effectiveRules, calcFunding, personCost, calcBudget, buildXlsx, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = RB;
  else root.RB = RB;
})(typeof self !== 'undefined' ? self : this);
