// 구글 Apps Script(시트·드라이브·메일) 흉내 — 서버 스크립트를 Node 에서 시험하기 위한 최소 구현
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pad = n => String(n).padStart(2, '0');
function display(v) {
  if (v == null) return '';
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  if (typeof v === 'string' && v.startsWith("'")) return v.slice(1);        // 글자 강제 표시(')
  if (typeof v === 'string' && v.startsWith('=')) return '#수식실행됨';        // 수식 주입이 일어나면 드러나게
  return String(v);
}
// 서식 관련 함수(색·폭·테두리 등)는 기록만 하고 자기 자신을 돌려줌 → 체이닝 가능
const styleLog = [];
const chain = (target, label) => new Proxy(target, {
  get(t, k) {
    if (k in t) return t[k];
    if (typeof k === 'symbol') return undefined;
    return (...args) => { styleLog.push(`${label}.${String(k)}`); return chain(t, label); };
  }
});
// 시트에 숫자처럼 보이는 글자를 넣으면 숫자로 바뀜 (실제 시트와 같게)
const store = v => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); return chain(this, 'Range'); }
  _grid(fn) {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn((this.sh.d[this.r - 1 + i] || [])[this.c - 1 + j])); out.push(row); }
    return out;
  }
  getValues() { return this._grid(v => (v == null ? '' : v)); }
  getDisplayValues() { return this._grid(display); }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => {
      const R = this.r - 1 + i; while (this.sh.d.length <= R) this.sh.d.push([]);
      this.sh.d[R][this.c - 1 + j] = store(v);
    }));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFormula(f) { return this.setValues([['=' + String(f).replace(/^=/, '')]]); }
  applyRowBanding() { this.sh.bandings.push(1); return chain({}, 'Banding'); }
}
class Sheet {
  constructor(name) { this.name = name; this.d = []; this.bandings = []; this.rules = []; return chain(this, 'Sheet'); }
  getMaxRows() { return Math.max(1000, this.d.length); }
  getBandings() { const n = this.bandings.length; this.bandings = []; return Array.from({ length: n }, () => ({ remove() {} })); }
  setConditionalFormatRules(r) { this.rules = r; return this; }
  clear() { this.d = []; return this; }
  getName() { return this.name; }
  getLastRow() { return this.d.length; }
  getLastColumn() { return this.d.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(r) { this.d.push(r.map(store)); }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') {   // 'B2' 같은 A1 표기
      const m = r.match(/^([A-Z]+)(\d+)$/); let col = 0;
      for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
      return new Range(this, Number(m[2]), col, 1, 1);
    }
    return new Range(this, r, c, nr, nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  insertRowAfter(n) { this.d.splice(n, 0, []); }
  deleteRow(n) { this.d.splice(n - 1, 1); }
  setFrozenRows() {}
}
function makeEnv(opts = {}) {
  const sheets = new Map();
  const ss = {
    getSheetByName: n => sheets.get(n) || null,
    getSheets: () => [...sheets.values()],
    deleteSheet: sh => { sheets.delete(sh.getName()); },
    insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; },
    toast: () => {},
    getId: () => 'SHEETID',
    getName: () => '메종도로시 운영'
  };
  const user = { active: opts.active === undefined ? 'owner@example.com' : opts.active, owner: 'owner@example.com' };
  const mails = [], files = [], folders = [], triggers = [], copies = [];
  const clock = { weekday: null };   // 'u' 요일(1=월) 고정용
  const base = () => ({
    SpreadsheetApp: { BandingTheme: { LIGHT_GREY: 'lg' }, BorderStyle: { SOLID: 'solid' }, newConditionalFormatRule: () => chain({ build: () => ({ rule: 1 }) }, 'Rule'), newDataValidation: () => chain({ build: () => ({ dv: 1 }) }, 'DV'), getActiveSpreadsheet: () => ss, openById: () => ss, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    Session: { getActiveUser: () => ({ getEmail: () => user.active }), getEffectiveUser: () => ({ getEmail: () => user.owner }) },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) },
    Utilities: {
      base64Decode: b => [...Buffer.from(b, 'base64')],
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      formatDate: (d, tz, f) => f === 'u' ? String(clock.weekday || ((d.getDay() + 6) % 7) + 1)
        : f === 'M월 d일' ? `${d.getMonth() + 1}월 ${d.getDate()}일`
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'anyone' }, Permission: { VIEW: 'view' },
      getFoldersByName: n => { const f = folders.filter(x => x.name === n); let i = 0; return { hasNext: () => i < f.length, next: () => f[i++] }; },
      getFileById: () => ({ makeCopy: (name, folder) => { const c = { name, folder, trashed: false, created: new Date(Date.now() + copies.length), getDateCreated() { return this.created; }, setTrashed(v) { this.trashed = v; } }; copies.push(c); folder.items.push(c); return c; } }),
      createFolder: name => { const f = { name, items: [], getFiles() { const l = this.items.filter(x => !x.trashed); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }, createFile: blob => { const file = { id: 'FILE' + (files.length + 1) + 'abcdefghij', blob, sharing: null, getId() { return this.id; }, setSharing(a, p) { this.sharing = [a, p]; } }; files.push(file); return file; } }; folders.push(f); return f; }
    },
    ScriptApp: {
      WeekDay: { MONDAY: 'MONDAY' },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => { const spec = { fn }; const b = new Proxy({}, { get: (_, k) => k === 'create' ? () => { const t = { spec, getHandlerFunction: () => fn }; triggers.push(t); return t; } : (...a) => { spec[k] = a; return b; } }); return b; }
    },
    console, Date, JSON, Math, Number, String, Object, Array, Error, RegExp, Buffer
  });
  // 스크립트마다 별도 실행 공간(같은 시트·드라이브·메일 공유) — 공개 스크립트와 관리자 스크립트가 따로 배포되는 것과 같음
  const load = rel => {
    const ctx = vm.createContext(base());
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../maison-dorothy', rel), 'utf8'), ctx, { filename: rel });
    return ctx;
  };
  return { ss, sheets, user, mails, files, load, triggers, copies, folders, clock };
}
module.exports = { makeEnv, Sheet, styleLog };
