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
  function buildXlsx(state, title) {
    const r = calcBudget(state);
    const N = 1, B = 2; // 스타일: 1=천단위 숫자, 2=굵게
    const t1 = [[{ v: title || 'R&D 사업비 편성표', s: B }], ['단위: 천원'], [],
      [{ v: '구분', s: B }, { v: '금액', s: B }],
      ['정부출연금', { v: r.funding.gov, s: N }],
      ['기관부담금', { f: 'B12-B5', s: N }],
      [], [{ v: '비목', s: B }, { v: '현금', s: B }, { v: '현물', s: B }, { v: '합계', s: B }, { v: '비율(%)', s: B }]];
    const start = t1.length + 1; // 엑셀 행 번호(1부터)
    r.rows.forEach((row, i) => {
      const n = start + i;
      t1.push([row.label, { v: row.cash, s: N }, { v: row.inkind, s: N }, { f: `B${n}+C${n}`, s: N }, { f: `IF($D$${start + r.rows.length}=0,0,ROUND(D${n}/$D$${start + r.rows.length}*100,1))` }]);
    });
    const end = start + r.rows.length - 1;
    // 합계 행(정부출연금 행 B5, 기관부담금 B6이 B12 를 참조하므로 합계 행 위치를 고정하기 위해 아래에 둠)
    t1.push([{ v: '합계', s: B }, { f: `SUM(B${start}:B${end})`, s: N }, { f: `SUM(C${start}:C${end})`, s: N }, { f: `SUM(D${start}:D${end})`, s: N }, 100]);
    const totalRow = end + 1;
    t1[5][1] = { f: `D${totalRow}-B5`, s: N };
    t1.push([], ['정부출연금 비율(%)', { f: `IF(D${totalRow}=0,0,ROUND(B5/D${totalRow}*100,1))` }], ['기관부담 현금 비율(%)', { f: `IF(B6=0,0,ROUND((B${totalRow}-B5)/B6*100,1))` }],
      [], ['적용 기준', r.rules.label], ['정부지원 비율', r.rules.basis.gov], ['현금 부담', r.rules.basis.cash], ['간접비', r.rules.basis.indirect], ['근거 법령', `${SOURCES.decreeT1} / ${SOURCES.std} (기준일 ${BASIS_DATE})`],
      [], ['※ 참고용 계산입니다. 사업별 공고문·운영요령이 우선합니다.']);

    const t2 = [[{ v: '참여연구원 인건비', s: B }], ['단위: 천원'], [],
      [{ v: '성명', s: B }, { v: '연봉', s: B }, { v: '참여개월', s: B }, { v: '참여율(%)', s: B }, { v: '다른 과제 참여율(%)', s: B }, { v: '구분', s: B }, { v: '인건비', s: B }]];
    r.people.forEach((p, i) => {
      const n = 5 + i;
      t2.push([p.name || '', { v: int(p.salary), s: N }, int(p.months), pct(p.rate), pct(p.otherRate), RB_KIND_LABEL(p), { f: `ROUND(B${n}/12*C${n}*D${n}/100,0)`, s: N }]);
    });
    if (r.people.length) t2.push([{ v: '합계', s: B }, '', '', '', '', '', { f: `SUM(G5:G${4 + r.people.length})`, s: N }]);

    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf numFmtId="3" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="사업비 편성표" sheetId="1" r:id="rId1"/><sheet name="인건비" sheetId="2" r:id="rId2"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml(t1, [24, 14, 14, 14, 10]) },
      { name: 'xl/worksheets/sheet2.xml', data: sheetXml(t2, [14, 12, 10, 10, 18, 10, 12]) },
    ];
    return zip(files);
  }

  const RB = { BASIS_DATE, SOURCES, RULESETS, LIMITS, ITEMS, PERSON_KINDS, DEFAULT_RULES, int, pct, effectiveRules, calcFunding, personCost, calcBudget, buildXlsx, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = RB;
  else root.RB = RB;
})(typeof self !== 'undefined' ? self : this);
