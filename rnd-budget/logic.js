// R&D 사업비 계산 로직(순수 함수). 금액 단위: 천원(정수).
// 기본 비율은 일반적인 국가R&D 기준값이며, 공고문·사업별 운영요령이 우선한다(화면에서 수정 가능).
(function (root) {
  'use strict';

  const ORG_TYPES = {
    sme: { label: '중소기업', govMaxPct: 75, cashMinPct: 10 },
    mid: { label: '중견기업', govMaxPct: 70, cashMinPct: 13 },
    large: { label: '대기업', govMaxPct: 50, cashMinPct: 15 },
    custom: { label: '직접 입력', govMaxPct: 75, cashMinPct: 10 },
  };

  // 비목(직접비). 간접비는 계산 항목
  const ITEMS = [
    { key: 'personnel', label: '인건비', inkind: true },
    { key: 'student', label: '학생인건비', inkind: false },
    { key: 'equipment', label: '연구시설·장비비', inkind: true },
    { key: 'material', label: '연구재료비', inkind: true },
    { key: 'outsource', label: '위탁연구개발비', inkind: false },
    { key: 'activity', label: '연구활동비', inkind: false },
    { key: 'allowance', label: '연구수당', inkind: false },
  ];

  const DEFAULT_RULES = { indirectPct: 10, allowanceMaxPct: 20 };

  const int = (v) => {
    const n = Math.round(Number(String(v ?? '').replace(/[,\s]/g, '')));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const pct = (v, max = 100) => {
    const n = Number(String(v ?? '').replace(/[,%\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };

  /** 정부출연금 → 최소 총사업비·기관부담금·최소 현금 */
  function calcFunding(gov, govMaxPct, cashMinPct) {
    gov = int(gov); govMaxPct = pct(govMaxPct); cashMinPct = pct(cashMinPct);
    if (!gov || !govMaxPct) return { gov, total: gov, org: 0, cashMin: 0, inkindMax: 0 };
    const total = Math.ceil((gov * 100) / govMaxPct);
    const org = total - gov;
    const cashMin = Math.ceil((org * cashMinPct) / 100);
    return { gov, total, org, cashMin, inkindMax: org - cashMin };
  }

  /** 참여연구원 1명 인건비 = 연봉 ÷ 12 × 참여개월 × 참여율 */
  function personCost(p) {
    const salary = int(p.salary), months = Math.min(int(p.months), 12), rate = pct(p.rate);
    return Math.round((salary / 12) * months * (rate / 100));
  }

  /**
   * 전체 편성 계산
   * state: { gov, govMaxPct, cashMinPct, indirectPct, allowanceMaxPct, people:[{name,salary,months,rate,otherRate,inkind}], items:{key:{cash,inkind}} }
   */
  function calcBudget(state) {
    const s = state || {};
    const funding = calcFunding(s.gov, s.govMaxPct, s.cashMinPct);
    const people = (s.people || []).map((p) => ({ ...p, cost: personCost(p), totalRate: pct(p.rate, 1000) + pct(p.otherRate, 1000) }));
    const rows = ITEMS.map((it) => {
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
    const outsource = rows.find((r) => r.key === 'outsource').total;
    const indirectPct = s.indirectPct === undefined ? DEFAULT_RULES.indirectPct : pct(s.indirectPct);
    const indirectBase = Math.max(0, direct.total - direct.inkind - outsource);
    const indirect = Math.floor((indirectBase * indirectPct) / 100);
    rows.push({ key: 'indirect', label: '간접비', cash: indirect, inkind: 0, total: indirect, computed: true });
    const total = { cash: direct.cash + indirect, inkind: direct.inkind, total: direct.total + indirect };
    const checks = runChecks({ s, funding, rows, total, people, indirectBase, indirectPct });
    return { funding, people, rows, direct, indirectBase, indirect, total, checks };
  }

  function runChecks({ s, funding, rows, total, people, indirectBase, indirectPct }) {
    const out = [];
    const add = (level, msg) => out.push({ level, msg });
    const fmt = (n) => n.toLocaleString('ko-KR');
    const gov = funding.gov;
    if (!gov) { add('info', '정부출연금을 입력하면 기관부담금과 편성 점검 결과가 표시됩니다.'); return out; }
    if (!total.total) { add('info', `최소 총사업비 ${fmt(funding.total)}천원에 맞춰 비목을 편성하세요.`); return out; }

    const govMaxPct = pct(s.govMaxPct);
    const cashMinPct = pct(s.cashMinPct);
    const govShare = (gov / total.total) * 100;
    if (total.total < funding.total) add('error', `총사업비가 최소 총사업비보다 ${fmt(funding.total - total.total)}천원 부족합니다(정부출연금 비율 ${govShare.toFixed(1)}% > ${govMaxPct}%).`);
    else if (total.total === funding.total) add('ok', `총사업비 ${fmt(total.total)}천원 — 정부출연금 비율 ${govShare.toFixed(1)}%(한도 ${govMaxPct}%).`);
    else add('ok', `총사업비 ${fmt(total.total)}천원 — 최소 총사업비보다 ${fmt(total.total - funding.total)}천원 많음(정부출연금 비율 ${govShare.toFixed(1)}%).`);

    const org = total.total - gov;
    const orgCash = total.cash - gov;
    if (orgCash < 0) add('error', `현금 편성 ${fmt(total.cash)}천원이 정부출연금보다 ${fmt(-orgCash)}천원 적습니다. 정부출연금은 전액 현금 비목으로 편성해야 합니다.`);
    else {
      const need = Math.ceil((org * cashMinPct) / 100);
      if (orgCash < need) add('error', `기관부담금 중 현금 ${fmt(orgCash)}천원 — 최소 ${fmt(need)}천원(${cashMinPct}%)보다 ${fmt(need - orgCash)}천원 부족합니다.`);
      else add('ok', `기관부담금 ${fmt(org)}천원 = 현금 ${fmt(orgCash)} + 현물 ${fmt(total.inkind)}(현금 ${org ? ((orgCash / org) * 100).toFixed(1) : 0}%, 최소 ${cashMinPct}%).`);
    }

    const personnel = rows.find((r) => r.key === 'personnel').total + rows.find((r) => r.key === 'student').total;
    const allowance = rows.find((r) => r.key === 'allowance').total;
    const allowanceMaxPct = s.allowanceMaxPct === undefined ? DEFAULT_RULES.allowanceMaxPct : pct(s.allowanceMaxPct);
    const allowanceMax = Math.floor((personnel * allowanceMaxPct) / 100);
    if (allowance > allowanceMax) add('error', `연구수당 ${fmt(allowance)}천원이 한도 ${fmt(allowanceMax)}천원(인건비·학생인건비의 ${allowanceMaxPct}%)을 넘습니다.`);

    for (const p of people) {
      const name = p.name || '이름 없음';
      if (p.totalRate > 100) add('error', `${name}: 총 참여율 ${p.totalRate}%(이 과제 ${pct(p.rate, 1000)}% + 다른 과제 ${pct(p.otherRate, 1000)}%)가 100%를 넘습니다.`);
      if (p.cost === 0 && (p.name || p.salary)) add('warn', `${name}: 연봉·참여개월·참여율을 확인하세요(인건비 0).`);
    }
    if (indirectBase && !indirectPct) add('warn', '간접비율이 0%입니다. 기관 고시 비율 또는 공고문 기준을 입력하세요.');
    out.push({ level: 'info', msg: `간접비 = (직접비 − 현물 − 위탁연구개발비) ${fmt(indirectBase)}천원 × ${indirectPct}%.` });
    return out;
  }

  // ---------- Pro 이용권(ECDSA P-256 서명 코드) ----------
  const b64uToBytes = (s) => {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };

  /** 코드 형식: base64url(JSON{id,exp,plan}).base64url(서명). 반환: {ok, id, exp, reason} */
  async function verifyLicense(code, publicJwk, today) {
    try {
      if (!publicJwk) return { ok: false, reason: 'not_ready' };
      const parts = String(code || '').trim().split('.');
      if (parts.length !== 2) return { ok: false, reason: 'format' };
      const subtle = (root.crypto || globalThis.crypto).subtle;
      const key = await subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const good = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBytes(parts[1]), new TextEncoder().encode(parts[0]));
      if (!good) return { ok: false, reason: 'signature' };
      const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
      if (payload.plan !== 'pro' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.exp)) return { ok: false, reason: 'format' };
      if (payload.exp < today) return { ok: false, reason: 'expired', id: payload.id, exp: payload.exp };
      return { ok: true, id: String(payload.id || ''), exp: payload.exp };
    } catch (e) {
      return { ok: false, reason: 'format' };
    }
  }

  // ---------- XLSX(Pro) — 의존성 없는 최소 생성기(무압축 ZIP) ----------
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
      [], ['※ 참고용 계산입니다. 공고문·사업별 운영요령·기관 간접비 고시 비율을 반드시 확인하세요.']);

    const t2 = [[{ v: '참여연구원 인건비', s: B }], ['단위: 천원'], [],
      [{ v: '성명', s: B }, { v: '연봉', s: B }, { v: '참여개월', s: B }, { v: '참여율(%)', s: B }, { v: '다른 과제 참여율(%)', s: B }, { v: '현금/현물', s: B }, { v: '인건비', s: B }]];
    r.people.forEach((p, i) => {
      const n = 5 + i;
      t2.push([p.name || '', { v: int(p.salary), s: N }, int(p.months), pct(p.rate), pct(p.otherRate), p.inkind ? '현물' : '현금', { f: `ROUND(B${n}/12*C${n}*D${n}/100,0)`, s: N }]);
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

  const RB = { ORG_TYPES, ITEMS, DEFAULT_RULES, int, pct, calcFunding, personCost, calcBudget, verifyLicense, buildXlsx, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = RB;
  else root.RB = RB;
})(typeof self !== 'undefined' ? self : this);
