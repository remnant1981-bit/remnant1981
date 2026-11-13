/* 메종도로시 - 순수 로직 (DOM 비의존). 화면(app.js)과 테스트가 공유함.
 * 가격(price)이 비어 있는 상품은 "가격 문의" 상품: 담을 수는 있고, 입금액은 사장님이 확인 후 안내 */
(function (root) {
  'use strict';

  const won = n => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
  const hasPrice = p => typeof p.price === 'number' && p.price > 0;
  const priceLabel = p => (hasPrice(p) ? won(p.price) : '가격 문의');

  // 같은 상품·컬러·사이즈는 수량만 늘림
  const lineKey = (id, color, size) => `${id}|${color}|${size}`;

  function addLine(cart, p, color, size) {
    const k = lineKey(p.id, color, size);
    const next = cart.map(x => ({ ...x }));
    const hit = next.find(x => x.k === k);
    if (hit) hit.q += 1;
    else next.push({ k, id: p.id, name: p.name, color, size, price: hasPrice(p) ? p.price : null, q: 1 });
    return next;
  }

  function removeOne(cart, i) {
    const next = cart.map(x => ({ ...x }));
    if (!next[i]) return next;
    if (next[i].q > 1) next[i].q -= 1; else next.splice(i, 1);
    return next;
  }

  // 수량 조절: delta 만큼 더하고 0 이하면 줄 삭제
  function changeQty(cart, i, delta) {
    const next = cart.map(x => ({ ...x }));
    if (!next[i]) return next;
    next[i].q += delta;
    if (next[i].q <= 0) next.splice(i, 1);
    else if (next[i].q > 9) next[i].q = 9;
    return next;
  }

  // 가격 문의 상품이 섞이면 택배비·입금액은 null(확인 후 안내). 픽업은 언제나 택배비 0
  function totals(cart, shipping, pickup) {
    const count = cart.reduce((s, x) => s + x.q, 0);
    const unpriced = cart.filter(x => !(x.price > 0)).reduce((s, x) => s + x.q, 0);
    const sub = cart.reduce((s, x) => s + (x.price > 0 ? x.price * x.q : 0), 0);
    if (unpriced) return { sub, ship: pickup ? 0 : null, all: null, count, unpriced };
    const ship = (pickup || sub === 0 || sub >= shipping.freeOver) ? 0 : shipping.fee;
    return { sub, ship, all: sub + ship, count, unpriced };
  }

  // 사이즈 선택지: 정해진 사이즈(S·M·L 등)가 있으면 그것, 없으면 "평소 사이즈"(추천 범위 안)
  const USUAL = [66, 77, 88, 99];
  function sizeOptions(p) {
    if (Array.isArray(p.sizes) && p.sizes.length) return { label: '사이즈', values: p.sizes.slice() };
    const [lo, hi] = Array.isArray(p.fit) ? p.fit : [66, 99];
    return { label: '평소 입는 사이즈', values: USUAL.filter(s => s >= lo && s <= hi).map(s => `평소 ${s}`) };
  }
  function fitLabel(p) {
    if (Array.isArray(p.sizes) && p.sizes.length) return p.sizes.join(' · ');
    if (Array.isArray(p.fit)) return `${p.fit[0]}~${p.fit[1]} 추천`;
    return '사이즈 상담';
  }
  // "내 사이즈" 필터: 추천 범위를 아는 상품만 거르고, 모르는 상품은 상담 대상으로 남김
  function fitsSize(p, size) {
    if (!size) return true;
    if (!Array.isArray(p.fit)) return true;
    return size >= p.fit[0] && size <= p.fit[1];
  }

  // 무료배송까지 남은 금액 (가격 문의 상품이 있거나 이미 무료면 0)
  function freeShipLeft(cart, shipping) {
    const t = totals(cart, shipping, false);
    if (t.unpriced || !t.sub) return 0;
    return Math.max(0, shipping.freeOver - t.sub);
  }

  // 휴대폰 번호 입력 중 자동 하이픈 (010-1234-5678, 02-123-4567)
  function formatPhone(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.startsWith('02')) return d.length < 3 ? d : d.length < 6 ? `${d.slice(0, 2)}-${d.slice(2)}` : d.length < 10 ? `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}` : `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length < 4) return d;
    if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length < 11) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }

  // 영업 상태: sched = { days:[0~6, 일=0], from:'10:00', to:'20:00' }
  function openStatus(now, sched) {
    const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const day = now.getDay(), min = now.getHours() * 60 + now.getMinutes();
    const from = toMin(sched.from), to = toMin(sched.to);
    if (sched.days.includes(day) && min >= from && min < to) return { open: true, text: `영업 중 · ${sched.to}까지` };
    const names = ['일', '월', '화', '수', '목', '금', '토'];
    for (let k = 0; k < 8; k++) {
      const d = (day + k) % 7;
      if (!sched.days.includes(d)) continue;
      if (k === 0 && min < from) return { open: false, text: `준비 중 · 오늘 ${sched.from} 오픈` };
      if (k === 0) continue;
      return { open: false, text: `영업 종료 · ${k === 1 ? '내일' : names[d] + '요일'} ${sched.from} 오픈` };
    }
    return { open: false, text: '영업 시간 확인 중' };
  }

  /* ---------- 구글 시트 상품표 → 상품 목록 ---------- */
  // 사진 칸: 파일명(images 폴더), https 주소, 구글 드라이브 공유 링크 모두 허용. 그 밖의 값은 버림(보안)
  function normalizeImg(v) {
    const t = String(v || '').trim();
    if (!t) return '';
    const drive = t.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/);
    if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1000`;
    if (/^https:\/\/[^\s"'<>()\\]+$/.test(t)) return t;
    if (/^[\w.-]+\.(jpe?g|png|webp)$/i.test(t)) return t;
    return '';
  }
  const list = v => String(v || '').split(/[,/·]/).map(x => x.trim()).filter(Boolean).slice(0, 12);
  const yes = v => /^(y|yes|o|예|네|true|품절|1)$/i.test(String(v || '').trim());
  const no = v => /^(n|no|x|아니오|아니요|숨김|false|0)$/i.test(String(v || '').trim());
  const HEAD = { 노출: 'show', 아이디: 'id', id: 'id', 분류: 'cat', 상품명: 'name', 가격: 'price', 배지: 'badge', 사진: 'img', 추가사진: 'gallery',
    컬러: 'colors', 사이즈: 'sizes', 추천사이즈: 'fit', 설명: 'desc', 코디팁: 'tip', 인스타링크: 'post', 함께입기: 'pair', 품절: 'soldOut' };
  function parseSheet(rows) {
    if (!Array.isArray(rows)) return null;
    const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => String(c).trim() === '상품명'));
    if (hi < 0) return null;
    const keys = rows[hi].map(c => HEAD[String(c).replace(/\s/g, '')] || '');
    const out = [], seen = new Set();
    rows.slice(hi + 1).forEach((r, n) => {
      if (!Array.isArray(r)) return;
      const o = {}; keys.forEach((k, i) => { if (k) o[k] = String(r[i] == null ? '' : r[i]).trim(); });
      if (!o.name || no(o.show)) return;
      let id = /^[\w-]{1,30}$/.test(o.id || '') ? o.id : `r${hi + n + 2}`;
      if (seen.has(id)) return; seen.add(id);
      const price = Number(String(o.price || '').replace(/[^\d]/g, ''));
      const fm = String(o.fit || '').match(/(\d{2})\s*[~\-–]\s*(\d{2})/);
      const badge = /^(new|신상)$/i.test(o.badge || '') ? 'NEW' : (o.badge || '').slice(0, 10);
      const post = /^https:\/\/(www\.)?instagram\.com\/[^\s"'<>]+$/.test(o.post || '') ? o.post : '';
      out.push({
        id, cat: (o.cat || '기타').slice(0, 10), name: o.name.slice(0, 40), price: price > 0 ? price : null,
        badge: badge || undefined, img: normalizeImg(o.img), gallery: String(o.gallery || '').split(/[\s,]+/).map(normalizeImg).filter(Boolean).slice(0, 6),
        colors: list(o.colors), sizes: list(o.sizes).length ? list(o.sizes) : undefined, fit: fm ? [Number(fm[1]), Number(fm[2])] : undefined,
        desc: (o.desc || '').slice(0, 400), tip: (o.tip || '').slice(0, 200), post, pair: list(o.pair), soldOut: yes(o.soldOut)
      });
    });
    out.forEach(p => { p.pair = p.pair.filter(id => seen.has(id) && id !== p.id); });
    return out.length ? out : null;
  }

  const isPhone = s => /^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(String(s || '').trim());

  function validate(o) {
    const miss = [];
    if (!String(o.name || '').trim()) miss.push('성함');
    if (!isPhone(o.phone)) miss.push('연락처');
    if (!o.pickup && !String(o.address || '').trim()) miss.push('배송 주소');
    if (!o.agree) miss.push('개인정보 수집 동의');
    return miss;
  }

  const pad = n => String(n).padStart(2, '0');
  const orderNo = (d = new Date(), rnd = Math.random()) =>
    `D${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${pad(Math.floor(rnd * 100))}`;

  function orderText(no, cart, t, o) {
    const opt = x => [x.color, x.size].filter(Boolean).join('/');
    const lines = cart.map(x => `· ${x.name}${opt(x) ? ` (${opt(x)})` : ''} ×${x.q} ${x.price > 0 ? won(x.price * x.q) : '가격 문의'}`);
    return [
      `[메종도로시 주문] ${no}`,
      ...lines,
      `택배비: ${t.ship === null ? '확인 후 안내' : t.ship ? won(t.ship) : '무료'}`,
      `입금액: ${t.all === null ? '확인 후 안내' : won(t.all)}`,
      '',
      `받는 분: ${o.name.trim()}`,
      `연락처: ${o.phone.trim()}`,
      `받는 방법: ${o.pickup ? '매장 픽업' : '택배'}`,
      ...(o.pickup ? [] : [`주소: ${o.address.trim()}`]),
      ...(String(o.memo || '').trim() ? [`메모: ${o.memo.trim()}`] : [])
    ].join('\n');
  }

  const api = { won, hasPrice, priceLabel, lineKey, addLine, removeOne, changeQty, totals, freeShipLeft, formatPhone, openStatus, normalizeImg, parseSheet, sizeOptions, fitLabel, fitsSize, isPhone, validate, orderNo, orderText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DLogic = api;
})(typeof self !== 'undefined' ? self : this);
