/* 쿠폰 지갑 푸시 서버 - 핵심 로직 (Cloudflare Workers / Node 공용, 외부 의존성 없음)
 *
 * 저장하는 것: 푸시 주소(endpoint), 기기 비밀값의 해시, "알림을 보낼 날짜" 목록, 시간대·알림 시각.
 * 저장하지 않는 것: 쿠폰 이름·내용 등 앱 데이터. 푸시는 내용 없는 신호이고, 알림 문구는 기기가 만든다. */

const enc = new TextEncoder();

export const LIMITS = {
  MAX_SUBS: 30,          // 개인용: 등록 가능한 기기 수 (무료 한도의 요청당 호출 수 제한도 고려)
  MAX_SCHEDULE: 400,     // 날짜 목록 최대 길이
  MAX_BODY: 20000,       // 요청 본문 최대 바이트
  WINDOW_HOURS: 3,       // 알림 시각부터 이 시간 안에 성공할 때까지 재시도
  MAX_SENDS_PER_RUN: 20, // cron 1회당 전송 상한
  TTL_SECONDS: 150 * 86400 // 갱신 없는 등록은 KV가 자동 삭제
};

/* ---------- 인코딩/해시 ---------- */
export const b64u = {
  encode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
};
export const b64uText = s => b64u.encode(enc.encode(s));
export async function sha256b64u(text) { return b64u.encode(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

// 길이가 같을 때 시간 차이 없이 비교
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- 입력 검증 ---------- */
// 클라이언트가 보낸 주소로 서버가 요청을 보내므로(SSRF 위험) 알려진 푸시 서비스 호스트만 허용
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/
];
export function isAllowedPushEndpoint(s) {
  if (typeof s !== 'string' || s.length > 1000) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
      PUSH_HOSTS.some(r => r.test(u.hostname));
  } catch (e) { return false; }
}

export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateSchedule(v) {
  if (!Array.isArray(v) || v.length > LIMITS.MAX_SCHEDULE) return null;
  const out = [...new Set(v)];
  return out.every(isRealDate) ? out.sort() : null;
}
const validTz = n => Number.isInteger(n) && n >= -720 && n <= 840;
const validHour = n => Number.isInteger(n) && n >= 0 && n <= 23;

/* ---------- 시각 ---------- */
// 기기의 시간대 오프셋(분)으로 환산한 현지 날짜·시
export function localParts(nowMs, tzOffsetMin) {
  const d = new Date(nowMs + tzOffsetMin * 60000);
  const p = n => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hour: d.getUTCHours() };
}

// 오늘이 알림 날짜이고, 알림 시각 이후(재시도 창 안)이며, 오늘 아직 보내지 않았으면 전송 대상
export function isDue(sub, nowMs) {
  const l = localParts(nowMs, sub.tzOffsetMin);
  return sub.schedule.includes(l.date) && sub.lastSent !== l.date &&
    l.hour >= sub.hour && l.hour < sub.hour + LIMITS.WINDOW_HOURS;
}

/* ---------- VAPID (RFC 8292) ---------- */
let genLock = null;
async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4; pub.set(b64u.decode(jwk.x), 1); pub.set(b64u.decode(jwk.y), 33);
  return { publicKey: b64u.encode(pub), privateKey: jwk.d };
}

// 환경변수로 주어지면 그것을 쓰고, 없으면 최초 1회 생성해 KV에 보관함 (별도 키 설정 불필요)
export async function getVapid(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let v = await env.SUBS.get('vapid', 'json');
  if (v) return v;
  genLock = genLock || generateVapid();
  const made = await genLock; genLock = null;
  await env.SUBS.put('vapid', JSON.stringify(made));
  return (await env.SUBS.get('vapid', 'json')) || made; // 동시에 만든 경우 저장된 쪽으로 통일
}

const keyCache = new Map();
async function signingKey(v) {
  if (!keyCache.has(v.publicKey)) {
    const p = b64u.decode(v.publicKey);
    if (p.length !== 65 || p[0] !== 4) throw new Error('invalid VAPID public key');
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u.encode(p.slice(1, 33)), y: b64u.encode(p.slice(33)), d: v.privateKey, ext: true };
    keyCache.set(v.publicKey, await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']));
  }
  return keyCache.get(v.publicKey);
}

export async function vapidAuthorization(endpoint, env, nowMs = Date.now()) {
  const v = await getVapid(env);
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://example.com' };
  const input = `${b64uText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64uText(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(v), enc.encode(input)); // r||s (JWS ES256 형식)
  return `vapid t=${input}.${b64u.encode(sig)}, k=${v.publicKey}`;
}

// 내용 없는 푸시 전송. 결과: ok | gone(구독 만료) | retry
export async function sendPush(endpoint, env, deps = {}) {
  const f = deps.fetch || fetch;
  try {
    const res = await f(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidAuthorization(endpoint, env, deps.now), TTL: '43200', Urgency: 'normal' },
      signal: AbortSignal.timeout(8000)
    });
    if (res.status >= 200 && res.status < 300) return { result: 'ok', status: res.status };
    if (res.status === 404 || res.status === 410) return { result: 'gone', status: res.status };
    return { result: 'retry', status: res.status };
  } catch (e) { return { result: 'retry', status: 0 }; }
}

/* ---------- 저장소 ---------- */
const subKey = id => `sub:${id}`;
const putSub = (env, id, sub) => env.SUBS.put(subKey(id), JSON.stringify(sub), { expirationTtl: LIMITS.TTL_SECONDS });
async function countSubs(env) {
  let n = 0, cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor, limit: 1000 });
    n += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && n <= LIMITS.MAX_SUBS);
  return n;
}

/* ---------- HTTP ---------- */
function corsFor(req, env) {
  const origin = req.headers.get('Origin');
  const h = { 'Cache-Control': 'no-store' };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    Object.assign(h, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Register-Code',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400', Vary: 'Origin'
    });
  }
  return h;
}
const reply = (body, status, cors) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...cors, ...(body === null ? {} : { 'Content-Type': 'application/json' }) } });

async function readJson(req) {
  const text = await req.text();
  if (text.length > LIMITS.MAX_BODY) return { error: 'too large' };
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 'invalid json' }; }
  catch (e) { return { error: 'invalid json' }; }
}

async function authorize(req, sub) {
  const m = /^Bearer (.{16,200})$/.exec(req.headers.get('Authorization') || '');
  return !!(m && sub && safeEqual(await sha256b64u(m[1]), sub.secretHash));
}

export async function handle(req, env, deps = {}) {
  const cors = corsFor(req, env);
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return reply(null, 204, cors);
  if (origin && origin !== env.ALLOWED_ORIGIN) return reply({ error: 'origin not allowed' }, 403, cors); // 브라우저는 허용된 출처에서만 호출 가능

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const now = deps.now ?? Date.now();

  if (req.method === 'GET' && path === '/') return reply({ ok: true, service: 'coupon-wallet-push' }, 200, cors);
  if (req.method === 'GET' && path === '/vapid') return reply({ publicKey: (await getVapid(env)).publicKey }, 200, cors);

  if (req.method === 'POST' && path === '/subscribe') {
    if (!env.REGISTER_CODE) return reply({ error: 'server not configured: REGISTER_CODE' }, 503, cors);
    if (!safeEqual(req.headers.get('X-Register-Code') || '', env.REGISTER_CODE)) return reply({ error: 'invalid register code' }, 401, cors);
    const { value: b, error } = await readJson(req);
    if (error) return reply({ error }, 400, cors);
    const schedule = validateSchedule(b.schedule);
    if (!isAllowedPushEndpoint(b.endpoint)) return reply({ error: 'invalid endpoint' }, 400, cors);
    if (!schedule || !validTz(b.tzOffsetMin) || !validHour(b.hour) || typeof b.secret !== 'string' || b.secret.length < 16 || b.secret.length > 200)
      return reply({ error: 'invalid body' }, 400, cors);
    const id = (await sha256b64u(b.endpoint)).slice(0, 32);
    const secretHash = await sha256b64u(b.secret);
    const prev = await env.SUBS.get(subKey(id), 'json');
    if (prev && !safeEqual(prev.secretHash, secretHash)) return reply({ error: 'already registered' }, 409, cors);
    if (!prev && (await countSubs(env)) >= LIMITS.MAX_SUBS) return reply({ error: 'subscription limit reached' }, 429, cors);
    await putSub(env, id, {
      endpoint: b.endpoint, secretHash, schedule, tzOffsetMin: b.tzOffsetMin, hour: b.hour,
      lastSent: prev ? prev.lastSent : '', fails: 0, createdAt: prev ? prev.createdAt : now, updatedAt: now
    });
    return reply({ id }, prev ? 200 : 201, cors);
  }

  const m = /^\/subscribe\/([A-Za-z0-9_-]{32})(\/test)?$/.exec(path);
  if (m) {
    const id = m[1];
    const sub = await env.SUBS.get(subKey(id), 'json');
    if (!sub) return reply({ error: 'not found' }, 404, cors);
    if (!(await authorize(req, sub))) return reply({ error: 'unauthorized' }, 401, cors);

    if (req.method === 'PUT' && !m[2]) {
      const { value: b, error } = await readJson(req);
      if (error) return reply({ error }, 400, cors);
      const schedule = validateSchedule(b.schedule);
      if (!schedule || !validTz(b.tzOffsetMin) || !validHour(b.hour)) return reply({ error: 'invalid body' }, 400, cors);
      await putSub(env, id, { ...sub, schedule, tzOffsetMin: b.tzOffsetMin, hour: b.hour, updatedAt: now });
      return reply({ ok: true }, 200, cors);
    }
    if (req.method === 'DELETE' && !m[2]) {
      await env.SUBS.delete(subKey(id));
      return reply({ ok: true }, 200, cors);
    }
    if (req.method === 'POST' && m[2]) {
      const r = await sendPush(sub.endpoint, env, deps);
      if (r.result === 'gone') { await env.SUBS.delete(subKey(id)); return reply({ error: 'subscription expired' }, 410, cors); }
      return reply({ result: r.result, status: r.status }, r.result === 'ok' ? 200 : 502, cors);
    }
  }
  return reply({ error: 'not found' }, 404, cors);
}

/* ---------- 예약 전송 (cron: 매시) ---------- */
export async function runCron(env, deps = {}) {
  const now = deps.now ?? Date.now();
  const stats = { checked: 0, sent: 0, removed: 0, failed: 0 };
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor, limit: 100 });
    for (const k of page.keys) {
      if (stats.sent + stats.failed >= LIMITS.MAX_SENDS_PER_RUN) return stats;
      const sub = await env.SUBS.get(k.name, 'json');
      stats.checked++;
      if (!sub || !isDue(sub, now)) continue;
      const r = await sendPush(sub.endpoint, env, deps);
      if (r.result === 'ok') {
        stats.sent++;
        await putSub(env, k.name.slice(4), { ...sub, lastSent: localParts(now, sub.tzOffsetMin).date, fails: 0 });
      } else if (r.result === 'gone') {
        stats.removed++;
        await env.SUBS.delete(k.name);
      } else {
        stats.failed++;
        await putSub(env, k.name.slice(4), { ...sub, fails: (sub.fails || 0) + 1 });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return stats;
}
