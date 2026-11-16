/* 쿠폰 지갑 - 서버 푸시 구독·동기화 (브라우저 전용)
 *
 * 서버(push-server/)에는 푸시 주소와 "알림을 보낼 날짜" 목록만 올림. 쿠폰 이름·내용은 올리지 않음.
 * 푸시는 내용 없는 신호이고, 알림 문구는 서비스워커가 이 기기의 데이터로 만듦(store.js handlePush). */
(function (root) {
  'use strict';

  const KEY = 'pushCfg';
  const DEFAULT_CFG = { enabled: false, server: '', code: '', hour: 9, publicKey: '', id: '', secret: '', endpoint: '', hash: '', syncedAt: 0 };

  const err = (code, message, status) => Object.assign(new Error(message), { code, status });
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in root && 'Notification' in root;
  const getCfg = async () => ({ ...DEFAULT_CFG, ...((await CWStore.getMeta(KEY)) || {}) });
  const setCfg = c => CWStore.setMeta(KEY, c);
  const tzOffsetMin = () => -new Date().getTimezoneOffset();

  const toB64u = buf => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = str => {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
  };
  const randomSecret = () => toB64u(crypto.getRandomValues(new Uint8Array(32)));
  const scheduleHash = (schedule, hour) => JSON.stringify([schedule, hour, tzOffsetMin()]);

  function normServer(s) {
    let u;
    try { u = new URL(String(s || '').trim()); } catch (e) { throw err('server', '서버 주소 형식이 올바르지 않음'); }
    if (u.protocol !== 'https:') throw err('server', '서버 주소는 https:// 로 시작해야 함');
    return u.origin;
  }

  const HTTP_MSG = {
    401: '등록 코드가 올바르지 않거나 인증에 실패함', 403: '허용되지 않은 출처임 (서버의 ALLOWED_ORIGIN 확인)',
    409: '이미 다른 기기 정보로 등록돼 있음', 410: '푸시 구독이 만료됨. 껐다가 다시 켜 주세요',
    429: '등록할 수 있는 기기 수를 넘었음', 503: '서버에 등록 코드(REGISTER_CODE)가 설정되지 않음'
  };

  async function api(server, path, { method = 'GET', headers = {}, body } = {}) {
    let res;
    try {
      res = await fetch(server + path, {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000)
      });
    } catch (e) { throw err('network', '서버에 연결하지 못함. 주소와 인터넷 연결을 확인해 주세요'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) throw err('http', HTTP_MSG[res.status] || `서버 오류 (${res.status})`, res.status);
    return data;
  }
  const bearer = cfg => ({ Authorization: `Bearer ${cfg.secret}` });

  // 이 서버의 키로 만든 구독을 돌려줌. 다른 키로 만든 구독이 남아 있으면 새로 만듦
  async function getSub(reg, publicKey, fresh) {
    let sub = await reg.pushManager.getSubscription();
    if (sub && !fresh) {
      const k = sub.options && sub.options.applicationServerKey ? toB64u(sub.options.applicationServerKey) : '';
      if (k && k !== publicKey) fresh = true;
    }
    if (sub && fresh) { await sub.unsubscribe().catch(() => {}); sub = null; }
    return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(publicKey) });
  }

  // 서버에 등록. 같은 주소가 다른 비밀값으로 남아 있으면(409) 구독을 새로 만들어 한 번 더 시도
  async function register(cfg, reg, data, sub) {
    for (let attempt = 0; ; attempt++) {
      const secret = randomSecret();
      try {
        const r = await api(cfg.server, '/subscribe', {
          method: 'POST', headers: { 'X-Register-Code': cfg.code },
          body: { endpoint: sub.endpoint, schedule: root.CW.pushSchedule(data), tzOffsetMin: tzOffsetMin(), hour: cfg.hour, secret }
        });
        return { id: r.id, secret, endpoint: sub.endpoint, hash: scheduleHash(root.CW.pushSchedule(data), cfg.hour), syncedAt: Date.now() };
      } catch (e) {
        if (e.status !== 409 || attempt > 0) throw e;
        sub = await getSub(reg, cfg.publicKey, true);
      }
    }
  }

  async function status() {
    const cfg = await getCfg();
    return { ...cfg, supported: supported(), permission: 'Notification' in root ? Notification.permission : 'unsupported' };
  }

  async function enable({ server, code, hour }, data) {
    if (!supported()) throw err('unsupported', '이 브라우저는 푸시를 지원하지 않음 (설치한 앱에서 사용해 주세요)');
    const origin = normServer(server);
    code = String(code || '').trim();
    if (!code) throw err('code', '등록 코드를 입력해 주세요');
    hour = Number(hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = 9;
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted')
      throw err('permission', '알림 권한이 필요함 (브라우저의 사이트 설정에서 허용해 주세요)');
    const { publicKey } = await api(origin, '/vapid');
    const reg = await navigator.serviceWorker.ready;
    const sub = await getSub(reg, publicKey);
    const cfg = { ...DEFAULT_CFG, ...(await getCfg()), enabled: true, server: origin, code, hour, publicKey };
    Object.assign(cfg, await register(cfg, reg, data, sub));
    await setCfg(cfg);
    return cfg;
  }

  async function disable() {
    const cfg = await getCfg();
    if (cfg.id && cfg.secret && cfg.server) await api(cfg.server, `/subscribe/${cfg.id}`, { method: 'DELETE', headers: bearer(cfg) }).catch(() => {}); // 서버에 닿지 않아도 이 기기에서는 끔
    try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* 무시 */ }
    await setCfg({ ...cfg, enabled: false, id: '', secret: '', endpoint: '', hash: '' });
  }

  // 데이터가 바뀌었거나 구독이 사라졌을 때 서버와 맞춤. 바뀐 게 없으면 네트워크를 쓰지 않음
  async function sync(data, force) {
    const cfg = await getCfg();
    if (!cfg.enabled || !supported()) return { skipped: true };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub || sub.endpoint !== cfg.endpoint) {                  // 브라우저가 구독을 정리했거나 바뀜 → 다시 구독하고 등록
      if (Notification.permission !== 'granted') return { skipped: true, reason: 'permission' };
      if (cfg.id && cfg.secret) await api(cfg.server, `/subscribe/${cfg.id}`, { method: 'DELETE', headers: bearer(cfg) }).catch(() => {});
      Object.assign(cfg, await register(cfg, reg, data, await getSub(reg, cfg.publicKey, true)));
      await setCfg(cfg);
      return { resubscribed: true };
    }
    const schedule = root.CW.pushSchedule(data);
    const hash = scheduleHash(schedule, cfg.hour);
    if (!force && hash === cfg.hash) return { unchanged: true };
    try {
      await api(cfg.server, `/subscribe/${cfg.id}`, { method: 'PUT', headers: bearer(cfg), body: { schedule, tzOffsetMin: tzOffsetMin(), hour: cfg.hour } });
    } catch (e) {
      if (e.status !== 404) throw e;                              // 서버가 등록 정보를 잃었으면 다시 등록
      Object.assign(cfg, await register(cfg, reg, data, sub));
      await setCfg(cfg);
      return { reregistered: true };
    }
    cfg.hash = hash; cfg.syncedAt = Date.now();
    await setCfg(cfg);
    return { updated: true };
  }

  async function setHour(hour, data) {
    const cfg = await getCfg();
    cfg.hour = hour;
    await setCfg(cfg);
    return sync(data, true);
  }

  // 서버가 이 기기로 푸시를 한 번 보내게 함. 도착하면 서비스워커가 "연결됨" 알림을 보여줌
  async function sendTest() {
    const cfg = await getCfg();
    if (!cfg.enabled) throw err('off', '서버 푸시가 꺼져 있음');
    await CWStore.setMeta('pushTestAt', Date.now());
    try { await api(cfg.server, `/subscribe/${cfg.id}/test`, { method: 'POST', headers: bearer(cfg) }); }
    catch (e) { await CWStore.setMeta('pushTestAt', 0); throw e; }
  }

  root.CWPush = { supported, status, enable, disable, sync, setHour, sendTest };
})(typeof self !== 'undefined' ? self : this);
