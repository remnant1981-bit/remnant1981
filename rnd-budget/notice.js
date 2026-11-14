// 공고문 → 적용 기준 추출(features.noticeImport). 파일은 브라우저 안에서만 읽고 외부로 보내지 않음.
// readNoticeFile: PDF(pdf.js, 필요할 때만 로드) · HWPX(ZIP+XML) · TXT → 텍스트
// extractNotice: 텍스트 → 후보 값 + 근거 문장(규칙 기반). 적용은 사용자가 확인 후 선택.
(function (root) {
  'use strict';

  // ---------- 텍스트 정리 ----------
  function normalize(t) {
    return String(t || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[％]/g, '%').replace(/[∼～〜]/g, '~').replace(/[：]/g, ':').replace(/[，]/g, ',')
      .replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }

  // ---------- 금액 → 천원 ----------
  const UNIT = { 억: 100000, 천만: 10000, 백만: 1000, 만: 10, 천: 1 };
  /** "3억원", "1억 5천만원", "300백만원", "150,000천원", "300,000,000원" → 천원 */
  function toThousand(s) {
    s = String(s).replace(/\s+/g, '');
    let total = 0, rest = s, matched = false;
    const re = /([\d,]+(?:\.\d+)?)(억|천만|백만|만|천)/g;
    let m;
    while ((m = re.exec(s))) { total += Number(m[1].replace(/,/g, '')) * UNIT[m[2]]; matched = true; rest = s.slice(re.lastIndex); }
    const tail = rest.match(/^([\d,]+)원/);
    if (matched) { if (tail && /^\d/.test(rest)) total += Number(tail[1].replace(/,/g, '')) / 1000; return Math.round(total); }
    const plain = s.match(/([\d,]+)원/);
    return plain ? Math.round(Number(plain[1].replace(/,/g, '')) / 1000) : 0;
  }
  const AMOUNT = '((?:[\\d,]+(?:\\.\\d+)?\\s*(?:억|천만|백만|만|천)\\s*)+(?:[\\d,]+\\s*)?원|[\\d,]{4,}\\s*원)';
  const fmt = (n) => Number(n).toLocaleString('ko-KR');

  const TYPES = [['중소기업', 'sme'], ['중견기업', 'mid'], ['대기업', 'large'], ['공기업', 'large']];
  const typeIn = (s) => { for (const [k, v] of TYPES) if (s.includes(k)) return { name: k, key: v }; return null; };
  const evidenceOf = (t, idx, len) => t.slice(Math.max(0, idx - 45), Math.min(t.length, idx + len + 45)).replace(/\n/g, ' ').trim();

  /**
   * 반환: [{ field, label, value, display, type, evidence }]
   * field: govAnnual · govTotal · periodMonths · govMaxPct · cashMinPct · indirectPct · outsourceMaxPct · allowanceMaxPct
   */
  function extractNotice(raw) {
    const t = normalize(raw);
    const out = [];
    const seen = new Set();
    const add = (field, label, value, display, type, idx, len) => {
      const key = field + ':' + (type ? type.key : '');
      if (seen.has(key) || value === null || value === undefined || Number.isNaN(value)) return;
      seen.add(key);
      out.push({ field, label, value, display, type: type ? type.name : '', typeKey: type ? type.key : '', evidence: evidenceOf(t, idx, len) });
    };
    let m;

    // 1) 정부지원연구개발비(연간·총액)
    const govKw = '(?:정부\\s*지원\\s*연구개발비|정부\\s*출연금|정부\\s*지원금|지원\\s*규모|지원\\s*금액|지원\\s*예산|과제당\\s*지원)';
    const reAnnual = new RegExp(govKw + '[^\\n]{0,40}?(?:연간|년간|연\\s|1차년도|당해\\s*연도|연차별)[^\\n]{0,15}?' + AMOUNT, 'g');
    while ((m = reAnnual.exec(t))) add('govAnnual', '정부지원연구개발비(연간)', toThousand(m[1]), `${fmt(toThousand(m[1]))}천원`, null, m.index, m[0].length);
    const reTotal = new RegExp(govKw + '[^\\n]{0,40}?총\\s*' + AMOUNT, 'g');
    while ((m = reTotal.exec(t))) add('govTotal', '정부지원연구개발비(총액)', toThousand(m[1]), `${fmt(toThousand(m[1]))}천원`, null, m.index, m[0].length);
    if (!out.some((x) => x.field === 'govAnnual')) {
      const reAny = new RegExp(govKw + '[^\\n]{0,30}?' + AMOUNT + '\\s*(?:이내|내외|한도|범위)', 'g');
      if ((m = reAny.exec(t)) && !/총\s*$/.test(t.slice(Math.max(0, m.index), m.index + m[0].indexOf(m[1])))) add('govAnnual', '정부지원연구개발비(연간)', toThousand(m[1]), `${fmt(toThousand(m[1]))}천원`, null, m.index, m[0].length);
    }

    // 2) 연구개발기간
    const rePeriod = /(?:연구\s*개발\s*기간|개발\s*기간|수행\s*기간|지원\s*기간|협약\s*기간)[^\n]{0,30}?(\d{1,3})\s*개월/g;
    if ((m = rePeriod.exec(t))) add('periodMonths', '연구개발기간', Number(m[1]), `${m[1]}개월`, null, m.index, m[0].length);
    else if ((m = /(?:연구\s*개발\s*기간|개발\s*기간|수행\s*기간|지원\s*기간)[^\n]{0,30}?(\d{1,2})\s*년\s*(?:이내|내외)?/g.exec(t))) add('periodMonths', '연구개발기간', Number(m[1]) * 12, `${Number(m[1]) * 12}개월(${m[1]}년)`, null, m.index, m[0].length);

    // 3)·4) 기관 유형별 비율 — 줄 단위로 문맥(정부지원 / 기관부담 / 현금) 판단, 이전 줄(표 머리글) 문맥 이어받음
    const lines = t.split('\n');
    let ctx = '', pos = 0, pendingType = null;
    for (const line of lines) {
      const here = pos; pos += line.length + 1;
      const onlyType = line.trim().match(/^(중소기업|중견기업|대기업|공기업)$/);
      if (onlyType) { pendingType = typeIn(onlyType[1]); continue; }
      if (/간접비|위탁|연구\s*수당|참여율|부채|유동/.test(line)) { ctx = ''; continue; }
      if (/현금/.test(line)) ctx = 'cash';
      else if (/정부\s*(?:지원|출연)/.test(line)) ctx = 'gov';
      else if (/(?:기관|민간)\s*부담/.test(line)) ctx = 'org';
      else if (!/(중소|중견|대)기업|공기업|\d\s*%/.test(line)) { if (line.length > 40) ctx = ''; continue; }
      const typed = /(중소기업|중견기업|대기업|공기업)[^%\n]{0,25}?(\d{1,3}(?:\.\d+)?)\s*%\s*(이하|이내|이상)/g;
      const plain = /(\d{1,3}(?:\.\d+)?)\s*%\s*(이하|이내|이상)/g;
      if (/부채|유동|참여율|비중|가점|감점|배점|지분|매출/.test(line)) continue; // 비율이지만 사업비 기준 아님
      const hits = [];
      let mm;
      while ((mm = typed.exec(line))) hits.push({ type: typeIn(mm[1]), v: Number(mm[2]), op: mm[3], idx: here + mm.index, len: mm[0].length });
      if (!hits.length) while ((mm = plain.exec(line))) hits.push({ type: pendingType, v: Number(mm[1]), op: mm[2], idx: here + mm.index, len: mm[0].length });
      for (const h of hits) {
        if (ctx === 'cash' && h.op === '이상' && h.v > 0 && h.v < 100) add('cashMinPct', '기관부담금 중 현금 비율', h.v, `${h.v}% 이상`, h.type, h.idx, h.len);
        else if (ctx === 'gov' && h.op !== '이상' && h.v > 0 && h.v <= 100) add('govMaxPct', '정부지원 비율 상한', h.v, `${h.v}% 이하`, h.type, h.idx, h.len);
        else if (ctx === 'org' && h.op === '이상' && h.v > 0 && h.v < 100) add('govMaxPct', '정부지원 비율 상한', 100 - h.v, `${100 - h.v}% 이하(기관부담 ${h.v}% 이상)`, h.type, h.idx, h.len);
      }
      pendingType = null;
    }


    // 5) 간접비
    if ((m = /간접비[^\n.]{0,30}?(미계상|계상\s*(?:불가|하지\s*않|할\s*수\s*없)|미지원|제외)/.exec(t))) add('indirectPct', '간접비율', 0, '간접비 계상 안 함(0%)', null, m.index, m[0].length);
    else if ((m = /간접비[^%\n]{0,40}?(\d{1,2}(?:\.\d+)?)\s*%\s*(?:이내|이하|범위|까지)?/.exec(t))) add('indirectPct', '간접비율', Number(m[1]), `${m[1]}%`, null, m.index, m[0].length);

    // 6) 위탁연구개발비·연구수당 한도
    if ((m = /위탁\s*연구\s*개발비[^%\n]{0,50}?(\d{1,2})\s*%\s*(?:이내|이하|를\s*초과)/.exec(t))) add('outsourceMaxPct', '위탁연구개발비 한도', Number(m[1]), `${m[1]}% 이하`, null, m.index, m[0].length);
    if ((m = /연구\s*수당[^%\n]{0,50}?(\d{1,2})\s*%\s*(?:이내|이하)/.exec(t))) add('allowanceMaxPct', '연구수당 한도', Number(m[1]), `${m[1]}% 이내`, null, m.index, m[0].length);
    return out;
  }

  /** 현재 기관 유형(ruleset)에 맞는 값 고르기: 유형별 값 우선, 없으면 공통 값 */
  function pickForType(items, ruleset) {
    const want = { sme: 'sme', midS: 'mid', midL: 'mid', large: 'large' }[ruleset] || '';
    const res = {};
    for (const it of items) {
      if (it.typeKey && it.typeKey !== want) continue;
      const cur = res[it.field];
      if (!cur || (!cur.typeKey && it.typeKey)) res[it.field] = it;
    }
    return res;
  }

  // ---------- 파일 읽기 ----------
  /** raw deflate 해제. 압축 데이터 뒤 여분 바이트(HWP에서 흔함)로 브라우저가 오류를 내도 풀린 내용은 사용 */
  async function inflateRaw(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = []; let total = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
    } catch (e) { if (!total) throw e; }
    const out = new Uint8Array(total); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  /** ZIP(HWPX)에서 이름 조건에 맞는 항목들 읽기 */
  async function unzipEntries(bytes, match) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zip');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = [];
    for (let k = 0; k < count && k < 2000; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), loff = v.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!match(name)) continue;
      const lstart = loff + 30 + v.getUint16(loff + 26, true) + v.getUint16(loff + 28, true);
      const data = bytes.subarray(lstart, lstart + csize);
      out.push({ name, data: method === 0 ? data : method === 8 ? await inflateRaw(data) : new Uint8Array() });
    }
    return out;
  }
  const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
  /** HWPX 본문 XML → 텍스트(문단마다 줄바꿈, 표 칸은 공백) */
  function hwpxXmlToText(xml) {
    return decodeXml(String(xml)
      .replace(/<hp:tab\b[^>]*\/>/g, ' ').replace(/<\/hp:p>/g, '\n').replace(/<\/hp:tc>/g, ' ')
      .replace(/<[^>]+>/g, ''));
  }
  async function readHwpx(bytes) {
    const entries = await unzipEntries(bytes, (n) => /^Contents\/section\d+\.xml$/i.test(n));
    if (!entries.length) throw new Error('hwpx');
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const dec = new TextDecoder();
    return entries.map((e) => hwpxXmlToText(dec.decode(e.data))).join('\n');
  }

  // ---------- HWP 5.0(구형, OLE 복합 문서) ----------
  /** OLE(CFB) 파일에서 경로 조건에 맞는 스트림 읽기. 반환: [{path, data}] */
  function cfbStreams(bytes, want) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(0, true) !== 0xe011cfd0 || v.getUint32(4, true) !== 0xe11ab1a1) throw new Error('cfb');
    const ss = 1 << v.getUint16(30, true), mss = 1 << v.getUint16(32, true);
    const cutoff = v.getUint32(56, true);
    const sec = (n) => 512 + n * ss;
    const difat = [];
    for (let i = 0; i < 109; i++) { const x = v.getUint32(76 + i * 4, true); if (x < 0xfffffffa) difat.push(x); }
    let dnext = v.getUint32(68, true), guard = 0;
    while (dnext < 0xfffffffa && guard++ < 1000) {
      for (let i = 0; i < ss / 4 - 1; i++) { const x = v.getUint32(sec(dnext) + i * 4, true); if (x < 0xfffffffa) difat.push(x); }
      dnext = v.getUint32(sec(dnext) + ss - 4, true);
    }
    const fat = [];
    for (const d of difat) for (let i = 0; i < ss / 4; i++) fat.push(v.getUint32(sec(d) + i * 4, true));
    const chain = (start, table) => { const out = []; let c = start, g = 0; while (c < 0xfffffffa && g++ < 1e6) { out.push(c); c = table[c]; } return out; };
    const readChain = (start, size) => {
      const out = new Uint8Array(chain(start, fat).length * ss); let o = 0;
      for (const c of chain(start, fat)) { out.set(bytes.subarray(sec(c), sec(c) + ss), o); o += ss; }
      return out.subarray(0, size);
    };
    const dirBytes = readChain(v.getUint32(48, true), 1e9);
    const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    const ents = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const nlen = dv.getUint16(o + 64, true);
      let name = ''; for (let k = 0; k + 2 < nlen; k += 2) name += String.fromCharCode(dv.getUint16(o + k, true));
      ents.push({ name, type: dirBytes[o + 66], left: dv.getUint32(o + 68, true), right: dv.getUint32(o + 72, true), child: dv.getUint32(o + 76, true), start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) });
    }
    const root = ents[0];
    const mini = root && root.start < 0xfffffffa ? readChain(root.start, root.size) : new Uint8Array();
    const minifat = [];
    const mfStart = v.getUint32(60, true);
    if (mfStart < 0xfffffffa) { const mf = readChain(mfStart, v.getUint32(64, true) * ss); const mv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength); for (let i = 0; i < mf.length / 4; i++) minifat.push(mv.getUint32(i * 4, true)); }
    const readStream = (e) => {
      if (e.size < cutoff) { const out = new Uint8Array(chain(e.start, minifat).length * mss); let o = 0; for (const c of chain(e.start, minifat)) { out.set(mini.subarray(c * mss, c * mss + mss), o); o += mss; } return out.subarray(0, e.size); }
      return readChain(e.start, e.size);
    };
    const out = [];
    const walk = (idx, prefix, depth) => {
      if (idx >= ents.length || idx === 0xffffffff || depth > 64) return;
      const e = ents[idx];
      walk(e.left, prefix, depth + 1); walk(e.right, prefix, depth + 1);
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.type === 2 && want(path)) out.push({ path, data: readStream(e) });
      if (e.type === 1) walk(e.child, path, depth + 1);
    };
    if (root) walk(root.child, '', 0);
    return out;
  }
  /** HWP 문단 레코드(PARA_TEXT, 태그 67)에서 글자만 추출 */
  function hwpRecordsToText(data) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = [];
    let i = 0;
    while (i + 4 <= data.length) {
      const h = v.getUint32(i, true); i += 4;
      const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff;
      if (size === 0xfff) { size = v.getUint32(i, true); i += 4; }
      if (tag === 67) {
        let s = '';
        for (let j = i; j + 1 < i + size && j + 1 < data.length;) {
          const c = v.getUint16(j, true);
          if (c < 32) { // 제어 문자: 일반(1칸)·확장/인라인(8칸)
            if ([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31].includes(c)) { if (c === 10) s += '\n'; j += 2; } else { if (c === 9) s += '\t'; j += 16; }
            continue;
          }
          s += String.fromCharCode(c); j += 2;
        }
        out.push(s);
      }
      i += size;
    }
    return out.join('\n');
  }
  async function readHwp(bytes) {
    const head = cfbStreams(bytes, (p) => p === 'FileHeader')[0];
    if (!head) throw new Error('hwp');
    const hv = new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength);
    const flags = hv.getUint32(36, true);
    if (flags & 2) throw new Error('hwp-locked'); // 암호 설정 문서
    if (flags & 4) throw new Error('hwp-dist');   // 배포용 문서(본문 암호화)
    const secs = cfbStreams(bytes, (p) => /^BodyText\/Section\d+$/.test(p)).sort((a, b) => Number(a.path.slice(16)) - Number(b.path.slice(16)));
    if (!secs.length) throw new Error('hwp');
    const parts = [];
    for (const s of secs) parts.push(hwpRecordsToText(flags & 1 ? await inflateRaw(s.data) : s.data));
    return parts.join('\n');
  }
  async function readPdf(bytes, base) {
    const lib = await import(new URL('vendor/pdfjs/pdf.min.mjs', base).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', base).href;
    const doc = await lib.getDocument({ data: bytes, cMapUrl: new URL('vendor/pdfjs/cmaps/', base).href, cMapPacked: true, isEvalSupported: false }).promise;
    const parts = [];
    for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      parts.push(c.items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join(''));
    }
    return parts.join('\n');
  }
  /** 파일 → 텍스트. 오류: 'hwp'(읽기 실패)·'hwp-locked'(암호)·'hwp-dist'(배포용)·'type'·'size'·'empty' */
  async function readNoticeFile(file, base) {
    const name = String(file.name || '').toLowerCase();
    if (file.size > 30 * 1024 * 1024) throw new Error('size');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text;
    if (name.endsWith('.hwp')) text = await readHwp(bytes);
    else if (name.endsWith('.pdf')) text = await readPdf(bytes, base);
    else if (name.endsWith('.hwpx')) text = await readHwpx(bytes);
    else if (name.endsWith('.txt')) text = new TextDecoder().decode(bytes);
    else throw new Error('type');
    if (!normalize(text)) throw new Error('empty');
    return text;
  }

  const RBN = { cfbStreams, hwpRecordsToText, readHwp, normalize, toThousand, extractNotice, pickForType, unzipEntries, hwpxXmlToText, readHwpx, readNoticeFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = RBN;
  else root.RBN = RBN;
})(typeof self !== 'undefined' ? self : this);
