/* 메종도로시 - 순수 로직 (DOM 비의존). 화면(app.js)과 테스트가 공유함. */
(function (root) {
  'use strict';

  const won = n => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;

  // 장바구니 줄 키: 같은 상품·컬러·사이즈는 수량만 늘림
  const lineKey = (id, color, size) => `${id}|${color}|${size}`;

  function addLine(cart, p, color, size) {
    const k = lineKey(p.id, color, size);
    const next = cart.map(x => ({ ...x }));
    const hit = next.find(x => x.k === k);
    if (hit) hit.q += 1;
    else next.push({ k, id: p.id, name: p.name, color, size, price: p.price, q: 1 });
    return next;
  }

  function removeOne(cart, i) {
    const next = cart.map(x => ({ ...x }));
    if (!next[i]) return next;
    if (next[i].q > 1) next[i].q -= 1; else next.splice(i, 1);
    return next;
  }

  // 픽업이거나 무료배송 기준 이상이면 택배비 0
  function totals(cart, shipping, pickup) {
    const sub = cart.reduce((s, x) => s + x.price * x.q, 0);
    const count = cart.reduce((s, x) => s + x.q, 0);
    const ship = (pickup || sub === 0 || sub >= shipping.freeOver) ? 0 : shipping.fee;
    return { sub, ship, all: sub + ship, count };
  }

  const isPhone = s => /^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(String(s || '').trim());

  // 주문서 검사: 빠진 항목 이름 목록 (비면 통과)
  function validate(o) {
    const miss = [];
    if (!String(o.name || '').trim()) miss.push('성함');
    if (!isPhone(o.phone)) miss.push('연락처');
    if (!o.pickup && !String(o.address || '').trim()) miss.push('배송 주소');
    if (!o.agree) miss.push('개인정보 수집 동의');
    return miss;
  }

  const pad = n => String(n).padStart(2, '0');
  // 주문번호: D월일-시분-임의2자리 (예: D1113-1452-07)
  const orderNo = (d = new Date(), rnd = Math.random()) =>
    `D${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${pad(Math.floor(rnd * 100))}`;

  function orderText(no, cart, t, o) {
    const lines = cart.map(x => `· ${x.name} (${x.color}/${x.size}) ×${x.q} ${won(x.price * x.q)}`);
    return [
      `[메종도로시 주문] ${no}`,
      ...lines,
      `택배비: ${t.ship ? won(t.ship) : '무료'}`,
      `입금액: ${won(t.all)}`,
      '',
      `받는 분: ${o.name.trim()}`,
      `연락처: ${o.phone.trim()}`,
      `받는 방법: ${o.pickup ? '매장 픽업' : '택배'}`,
      ...(o.pickup ? [] : [`주소: ${o.address.trim()}`]),
      ...(String(o.memo || '').trim() ? [`메모: ${o.memo.trim()}`] : [])
    ].join('\n');
  }

  const api = { won, lineKey, addLine, removeOne, totals, isPhone, validate, orderNo, orderText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DLogic = api;
})(typeof self !== 'undefined' ? self : this);
