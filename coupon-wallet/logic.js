/* 쿠폰 지갑 - 순수 로직 (DOM/저장소 비의존). 화면(app.js)·서비스워커(sw.js)·테스트가 공유함. */
(function (root) {
  'use strict';

  const VERSION = '1.1.0';

  /* ---------- 날짜 ---------- */
  const pad = n => String(n).padStart(2, '0');
  const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(parse(s)) === s;
  const today = (now = new Date()) => toStr(now);
  // b - a (일). 서머타임 등으로 24h가 아닌 날이 있어도 round로 보정
  const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  /* ---------- 금액 ---------- */
  const won = n => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
  // 좁은 카드용: 1만원 이상은 "1.2만원" 형태
  function wonCompact(n) {
    n = Math.round(Number(n) || 0);
    if (n < 10000) return won(n);
    const man = n / 10000;
    return `${man >= 100 ? Math.round(man).toLocaleString('ko-KR') : Math.round(man * 10) / 10}만원`;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- 쿠폰 ---------- */
  function couponStatus(c, t = today()) {
    if (c.usedAt) return 'used';
    if (c.expires && c.expires < t) return 'expired';
    return 'active';
  }
  const daysLeft = (c, t = today()) => (c.expires ? dayDiff(t, c.expires) : null);
  const ddayLabel = d => (d === null ? '기한 없음' : d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : `D+${-d}`);
  const ddayClass = d => (d === null ? 'mute' : d <= 1 ? 'bad' : d <= 7 ? 'warn' : '');

  /* ---------- 적립(별·스탬프·프리퀀시) ---------- */
  // done: 목표 달성 / overdue: 마감 지남(미달) / active: 진행 중
  function loyaltyState(l, t = today()) {
    if (l.current >= l.target) return 'done';
    if (l.deadline && l.deadline < t) return 'overdue';
    return 'active';
  }

  function pace(l, t = today()) {
    const rem = Math.max(0, l.target - l.current);
    if (rem === 0) return { cls: 'ok', text: '목표 달성 🎉' };
    if (!l.deadline) return { cls: '', text: `${rem} 남음` };
    const left = dayDiff(t, l.deadline);
    if (left < 0) return { cls: 'bad', text: `마감 지남 · ${rem} 미달` };
    const avail = left + 1; // 오늘 포함
    if (rem > avail) return { cls: 'bad', text: `D-${left} · ${rem} 남음 · 하루 1개로도 부족` };
    if (avail <= 7) return { cls: rem / avail > 0.5 ? 'warn' : '', text: `D-${left} · ${rem} 남음 · 하루 ${(rem / avail).toFixed(1)}개` };
    const perWeek = rem / (avail / 7);
    return { cls: perWeek > 3.5 ? 'warn' : '', text: `D-${left} · ${rem} 남음 · 주 ${perWeek.toFixed(1)}개 필요` };
  }

  /* ---------- 통계 ---------- */
  function stats(data, t = today()) {
    const m = t.slice(0, 7);
    let active = 0, saved = 0, missed = 0, total = 0, used = 0, expired = 0;
    for (const c of data.coupons) {
      const st = couponStatus(c, t);
      if (st === 'active') active++;
      if (st === 'used') {
        used++; total += c.saved || 0;
        if ((c.usedAt || '').slice(0, 7) === m) saved += c.saved || 0;
      }
      if (st === 'expired') {
        expired++;
        if ((c.expires || '').slice(0, 7) === m) missed += c.value || 0;
      }
    }
    return { active, saved, missed, total, rate: used + expired ? Math.round((used / (used + expired)) * 100) : null };
  }

  /* ---------- 알림 대상 ---------- */
  function notifyLines(data, t = today()) {
    const lines = [];
    for (const c of data.coupons) {
      if (couponStatus(c, t) !== 'active') continue;
      const d = daysLeft(c, t);
      if (d !== null && d <= 3) lines.push(`${c.brand} ${c.title} (${ddayLabel(d)})`);
    }
    for (const l of data.loyalty) {
      if (loyaltyState(l, t) !== 'active' || !l.deadline) continue;
      const d = dayDiff(t, l.deadline);
      if (d <= 7) lines.push(`${l.brand} ${l.name} 마감 ${ddayLabel(d)} (${l.current}/${l.target})`);
    }
    return lines;
  }

  /* ---------- 입력 정규화 (폼·백업 가져오기 공용) ---------- */
  const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);
  const num = (v, min = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, n) : min; };
  const dateOr = v => (isDate(v) ? v : '');
  const MAX_IMAGE = 8 * 1024 * 1024; // 문자열 길이 기준
  const imageOr = v =>
    typeof v === 'string' && v.length <= MAX_IMAGE && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '';

  function normalizeCoupon(r, newId = uid) {
    if (!r || typeof r !== 'object') return null;
    const brand = str(r.brand, 60), title = str(r.title, 120);
    if (!brand || !title) return null;
    const c = {
      id: str(r.id, 64) || newId(), brand, title,
      value: Math.round(num(r.value)), expires: dateOr(r.expires),
      code: str(r.code, 120), memo: str(r.memo, 500), image: imageOr(r.image)
    };
    if (dateOr(r.usedAt)) { c.usedAt = r.usedAt; c.saved = Math.round(num(r.saved)); }
    if (r.sample === true) c.sample = true;
    return c;
  }

  function normalizeLoyalty(r, newId = uid) {
    if (!r || typeof r !== 'object') return null;
    const brand = str(r.brand, 60), name = str(r.name, 120);
    if (!brand || !name) return null;
    const l = {
      id: str(r.id, 64) || newId(), brand, name,
      current: Math.floor(num(r.current)), target: Math.max(1, Math.floor(num(r.target, 1))),
      deadline: dateOr(r.deadline), reward: str(r.reward, 120), memo: str(r.memo, 500)
    };
    if (r.sample === true) l.sample = true;
    return l;
  }

  // 백업 JSON → 검증된 데이터. 잘못된 항목은 버리고 개수만 보고함
  function normalizeBackup(obj, newId = uid) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.coupons) || !Array.isArray(obj.loyalty)) return null;
    const coupons = [], loyalty = [];
    let dropped = 0;
    for (const r of obj.coupons) { const c = normalizeCoupon(r, newId); c ? coupons.push(c) : dropped++; }
    for (const r of obj.loyalty) { const l = normalizeLoyalty(r, newId); l ? loyalty.push(l) : dropped++; }
    return { coupons, loyalty, dropped };
  }

  const CW = {
    VERSION, toStr, parse, isDate, today, dayDiff, won, wonCompact, uid,
    couponStatus, daysLeft, ddayLabel, ddayClass, loyaltyState, pace, stats, notifyLines,
    normalizeCoupon, normalizeLoyalty, normalizeBackup
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CW;
  else root.CW = CW;
})(typeof self !== 'undefined' ? self : this);
