// 실행: node --test "tests/push-server/*.test.mjs"   (Node 20+, 의존성 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../push-server/src/core.js';

const { b64u, handle, runCron, getVapid, vapidAuthorization, isAllowedPushEndpoint, validateSchedule, isDue, localParts, LIMITS } = core;

const ORIGIN = 'https://remnant1981-bit.github.io';
const EP = 'https://fcm.googleapis.com/fcm/send/abc123';
const SECRET = 'x'.repeat(32);

function mockKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name }));
      const start = cursor ? Number(cursor) : 0;
      return { keys: keys.slice(start, start + limit), list_complete: start + limit >= keys.length, cursor: String(start + limit) };
    }
  };
}
const newEnv = (extra = {}) => ({ SUBS: mockKV(), ALLOWED_ORIGIN: ORIGIN, REGISTER_CODE: 'open-sesame', VAPID_SUBJECT: 'https://remnant1981-bit.github.io/remnant1981/', ...extra });
const req = (method, path, { body, headers = {}, origin = ORIGIN } = {}) =>
  new Request(`https://push.test.workers.dev${path}`, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const reg = (over = {}) => ({ endpoint: EP, schedule: ['2026-12-01', '2026-12-02'], tzOffsetMin: 540, hour: 9, secret: SECRET, ...over });
const asJson = async r => ({ status: r.status, body: await r.clone().json().catch(() => null), headers: r.headers });
async function register(env, over, code = 'open-sesame') {
  const r = await handle(req('POST', '/subscribe', { body: reg(over), headers: { 'X-Register-Code': code } }), env);
  return asJson(r);
}

test('b64u: 왕복 변환과 패딩 처리', () => {
  for (const len of [0, 1, 2, 3, 31, 32, 65]) {
    const a = crypto.getRandomValues(new Uint8Array(len));
    assert.deepEqual([...b64u.decode(b64u.encode(a))], [...a]);
  }
  assert.ok(!/[+/=]/.test(b64u.encode(new Uint8Array([251, 255, 254]))));
});

test('isAllowedPushEndpoint: 알려진 푸시 서비스만 허용(SSRF 방지)', () => {
  for (const ok of [EP, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=x'])
    assert.equal(isAllowedPushEndpoint(ok), true, ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest/meta-data', 'https://evil.com/x',
    'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com@evil.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
    'ftp://fcm.googleapis.com/x', 'not a url', '', null, 123, 'https://fcm.googleapis.com/' + 'a'.repeat(1100)])
    assert.equal(isAllowedPushEndpoint(bad), false, String(bad));
});

test('validateSchedule: 실제 날짜만, 중복 제거·정렬, 길이 제한', () => {
  assert.deepEqual(validateSchedule(['2026-12-02', '2026-12-01', '2026-12-02']), ['2026-12-01', '2026-12-02']);
  assert.equal(validateSchedule(['2026-02-30']), null);
  assert.equal(validateSchedule(['2026-1-1']), null);
  assert.equal(validateSchedule('2026-12-01'), null);
  assert.equal(validateSchedule([123]), null);
  assert.equal(validateSchedule(Array.from({ length: LIMITS.MAX_SCHEDULE + 1 }, (_, i) => `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`)), null);
  assert.deepEqual(validateSchedule([]), []);
});

test('localParts / isDue: 시간대·알림 시각·재시도 창·중복 방지', () => {
  // 2026-12-01 00:30 UTC = 한국 09:30
  const t = Date.UTC(2026, 11, 1, 0, 30);
  assert.deepEqual(localParts(t, 540), { date: '2026-12-01', hour: 9 });
  assert.deepEqual(localParts(t, -300), { date: '2026-11-30', hour: 19 });
  const sub = { schedule: ['2026-12-01'], tzOffsetMin: 540, hour: 9, lastSent: '' };
  assert.equal(isDue(sub, t), true);                                   // 09:30, 알림 시각 이후
  assert.equal(isDue(sub, Date.UTC(2026, 11, 1, 2, 30)), true);        // 11:30, 재시도 창(3시간) 안
  assert.equal(isDue(sub, Date.UTC(2026, 11, 1, 3, 30)), false);       // 12:30, 창 밖
  assert.equal(isDue(sub, Date.UTC(2026, 10, 30, 23, 30)), false);     // 08:30, 알림 시각 전
  assert.equal(isDue({ ...sub, lastSent: '2026-12-01' }, t), false);   // 오늘 이미 보냄
  assert.equal(isDue({ ...sub, schedule: ['2026-12-02'] }, t), false); // 오늘은 알림 날짜가 아님
});

test('VAPID: 키 최초 생성·보관·재사용, 서명 JWT가 공개키로 검증됨', async () => {
  const env = newEnv();
  const v1 = await getVapid(env);
  const v2 = await getVapid(env);
  assert.deepEqual(v1, v2);
  assert.equal(b64u.decode(v1.publicKey).length, 65);
  assert.equal(b64u.decode(v1.publicKey)[0], 4);
  assert.equal(b64u.decode(v1.privateKey).length, 32);

  const now = Date.UTC(2026, 11, 1);
  const auth = await vapidAuthorization(EP, env, now);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth);
  assert.ok(m, auth);
  const [, h, c, s, k] = m;
  assert.equal(k, v1.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64u.decode(h))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(new TextDecoder().decode(b64u.decode(c)));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, env.VAPID_SUBJECT);
  assert.ok(claims.exp > now / 1000 && claims.exp - now / 1000 <= 24 * 3600);
  const pub = await crypto.subtle.importKey('raw', b64u.decode(v1.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.decode(s), new TextEncoder().encode(`${h}.${c}`)), true);
  assert.equal(b64u.decode(s).length, 64); // JWS ES256은 r||s 64바이트

  // 환경변수로 주어진 키가 우선
  const env2 = newEnv({ VAPID_PUBLIC_KEY: v1.publicKey, VAPID_PRIVATE_KEY: v1.privateKey });
  assert.deepEqual(await getVapid(env2), v1);
});

test('HTTP: CORS 사전요청과 허용되지 않은 출처 거부', async () => {
  const env = newEnv();
  const pre = await handle(req('OPTIONS', '/subscribe'), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Register-Code/);
  const bad = await handle(req('GET', '/vapid', { origin: 'https://evil.example' }), env);
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const noOrigin = await handle(req('GET', '/', { origin: null }), env);   // 서버 간/curl 호출은 허용
  assert.equal(noOrigin.status, 200);
  const v = await asJson(await handle(req('GET', '/vapid'), env));
  assert.equal(v.status, 200);
  assert.equal(b64u.decode(v.body.publicKey).length, 65);
  assert.equal(v.headers.get('Cache-Control'), 'no-store');
});

test('POST /subscribe: 등록 코드·입력 검증·SSRF 거부', async () => {
  let r = await register(newEnv({ REGISTER_CODE: undefined }), {}, 'x');
  assert.equal(r.status, 503);                                          // 코드 미설정 서버는 등록 불가
  const env = newEnv();
  assert.equal((await register(env, {}, 'wrong')).status, 401);
  assert.equal((await register(env, { endpoint: 'https://169.254.169.254/x' })).status, 400);
  assert.equal((await register(env, { endpoint: 'https://evil.com/x' })).status, 400);
  assert.equal((await register(env, { schedule: ['2026-02-30'] })).status, 400);
  assert.equal((await register(env, { tzOffsetMin: 99999 })).status, 400);
  assert.equal((await register(env, { hour: 24 })).status, 400);
  assert.equal((await register(env, { secret: 'short' })).status, 400);
  assert.equal([...env.SUBS.m.keys()].filter(k => k.startsWith('sub:')).length, 0);
  const huge = await handle(req('POST', '/subscribe', { body: { pad: 'x'.repeat(LIMITS.MAX_BODY + 10) }, headers: { 'X-Register-Code': 'open-sesame' } }), env);
  assert.equal(huge.status, 400);
  const bad = await handle(new Request('https://push.test.workers.dev/subscribe', { method: 'POST', headers: { Origin: ORIGIN, 'X-Register-Code': 'open-sesame' }, body: '{not json' }), env);
  assert.equal(bad.status, 400);
});

test('POST /subscribe: 등록·재등록·충돌·최대 기기 수, 저장 내용에 비밀값 평문 없음', async () => {
  const env = newEnv();
  const a = await register(env);
  assert.equal(a.status, 201);
  assert.equal(a.body.id.length, 32);
  const stored = [...env.SUBS.m.entries()].find(([k]) => k.startsWith('sub:'))[1];
  assert.ok(!stored.includes(SECRET));                                  // 비밀값은 해시만 저장
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['createdAt', 'endpoint', 'fails', 'hour', 'lastSent', 'schedule', 'secretHash', 'tzOffsetMin', 'updatedAt']);
  const again = await register(env);                                    // 같은 비밀값 → 갱신
  assert.equal(again.status, 200); assert.equal(again.body.id, a.body.id);
  assert.equal((await register(env, { secret: 'y'.repeat(32) })).status, 409); // 다른 비밀값으로 덮어쓰기 불가
  for (let i = 1; i < LIMITS.MAX_SUBS; i++) assert.equal((await register(env, { endpoint: `${EP}${i}` })).status, 201);
  assert.equal((await register(env, { endpoint: `${EP}over` })).status, 429);
});

test('PUT/DELETE /subscribe/:id: 인증과 갱신·삭제', async () => {
  const env = newEnv();
  const { body: { id } } = await register(env);
  const auth = { Authorization: `Bearer ${SECRET}` };
  assert.equal((await handle(req('PUT', `/subscribe/${id}`, { body: { schedule: [], tzOffsetMin: 540, hour: 9 } }), env)).status, 401);
  assert.equal((await handle(req('PUT', `/subscribe/${id}`, { body: { schedule: [], tzOffsetMin: 540, hour: 9 }, headers: { Authorization: `Bearer ${'z'.repeat(32)}` } }), env)).status, 401);
  assert.equal((await handle(req('PUT', `/subscribe/${'A'.repeat(32)}`, { body: {}, headers: auth }), env)).status, 404);
  assert.equal((await handle(req('PUT', `/subscribe/${id}`, { body: { schedule: ['bad'], tzOffsetMin: 540, hour: 9 }, headers: auth }), env)).status, 400);
  const ok = await handle(req('PUT', `/subscribe/${id}`, { body: { schedule: ['2027-01-02', '2027-01-01'], tzOffsetMin: -300, hour: 20 }, headers: auth }), env);
  assert.equal(ok.status, 200);
  const sub = JSON.parse(env.SUBS.m.get(`sub:${id}`));
  assert.deepEqual([sub.schedule, sub.tzOffsetMin, sub.hour], [['2027-01-01', '2027-01-02'], -300, 20]);
  assert.equal(sub.endpoint, EP);                                       // 주소는 변경되지 않음
  assert.equal((await handle(req('DELETE', `/subscribe/${id}`, { headers: auth }), env)).status, 200);
  assert.equal(env.SUBS.m.has(`sub:${id}`), false);
});

test('POST /subscribe/:id/test: 내용 없는 푸시를 VAPID 인증으로 전송, 만료 구독은 삭제', async () => {
  const env = newEnv();
  const { body: { id } } = await register(env);
  const auth = { Authorization: `Bearer ${SECRET}` };
  const calls = [];
  const ok = await handle(req('POST', `/subscribe/${id}/test`, { headers: auth }), env, { fetch: async (u, o) => { calls.push([u, o]); return new Response(null, { status: 201 }); } });
  assert.equal(ok.status, 200);
  assert.equal(calls[0][0], EP);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].body, undefined);                            // 페이로드 없음
  assert.match(calls[0][1].headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.equal(calls[0][1].headers.TTL, '43200');
  const fail = await handle(req('POST', `/subscribe/${id}/test`, { headers: auth }), env, { fetch: async () => new Response(null, { status: 500 }) });
  assert.equal(fail.status, 502);
  const gone = await handle(req('POST', `/subscribe/${id}/test`, { headers: auth }), env, { fetch: async () => new Response(null, { status: 410 }) });
  assert.equal(gone.status, 410);
  assert.equal(env.SUBS.m.has(`sub:${id}`), false);
});

test('runCron: 알림 날짜·시각에만 전송, 하루 1회, 만료 삭제, 실패 재시도', async () => {
  const env = newEnv();
  const { body: { id } } = await register(env, { schedule: ['2026-12-01'] });
  const at = (h, mi = 0, d = 1) => Date.UTC(2026, 11, d, h, mi);          // UTC 기준
  let sent = 0, status = 201;
  const deps = now => ({ now, fetch: async () => { sent++; return new Response(null, { status }); } });

  // 11/30 23:00 UTC = 한국 12/1 08:00 → 알림 시각(09시) 전이라 보내지 않음
  assert.deepEqual(await runCron(env, deps(Date.UTC(2026, 10, 30, 23, 0))), { checked: 1, sent: 0, removed: 0, failed: 0 });
  assert.equal(sent, 0);
  // 한국 12/1 09:00 = UTC 12/1 00:00
  status = 500;
  let st = await runCron(env, deps(at(0, 0)));
  assert.deepEqual(st, { checked: 1, sent: 0, removed: 0, failed: 1 });  // 실패 → 기록하고 다음 시각에 재시도
  assert.equal(JSON.parse(env.SUBS.m.get(`sub:${id}`)).fails, 1);
  assert.equal(JSON.parse(env.SUBS.m.get(`sub:${id}`)).lastSent, '');
  status = 201;
  st = await runCron(env, deps(at(1, 0)));                               // 10:00, 재시도 창 안
  assert.deepEqual(st, { checked: 1, sent: 1, removed: 0, failed: 0 });
  const sub = JSON.parse(env.SUBS.m.get(`sub:${id}`));
  assert.equal(sub.lastSent, '2026-12-01'); assert.equal(sub.fails, 0);
  st = await runCron(env, deps(at(2, 0)));                               // 같은 날 다시 → 보내지 않음
  assert.equal(st.sent, 0);
  assert.equal(sent, 2);                                                 // 전송 시도는 실패 1회 + 성공 1회
});

test('runCron: 만료 구독 삭제, 전송 상한, 알림 날짜가 아니면 호출 없음', async () => {
  const env = newEnv();
  await register(env, { schedule: ['2026-12-01'] });
  const t = Date.UTC(2026, 11, 1, 0, 0);
  let st = await runCron(env, { now: t, fetch: async () => new Response(null, { status: 410 }) });
  assert.deepEqual(st, { checked: 1, sent: 0, removed: 1, failed: 0 });
  assert.equal([...env.SUBS.m.keys()].filter(k => k.startsWith('sub:')).length, 0);

  const env2 = newEnv();
  for (let i = 0; i < 25; i++) await register(env2, { endpoint: `${EP}${i}`, schedule: ['2026-12-01'] });
  let calls = 0;
  st = await runCron(env2, { now: t, fetch: async () => { calls++; return new Response(null, { status: 201 }); } });
  assert.equal(st.sent, LIMITS.MAX_SENDS_PER_RUN);                       // 1회 상한
  assert.equal(calls, LIMITS.MAX_SENDS_PER_RUN);
  st = await runCron(env2, { now: t + 60000, fetch: async () => { calls++; return new Response(null, { status: 201 }); } });
  assert.equal(st.sent, 5);                                              // 남은 기기는 다음 실행에서 처리

  const env3 = newEnv();
  await register(env3, { schedule: ['2026-12-05'] });
  let called = false;
  await runCron(env3, { now: t, fetch: async () => { called = true; return new Response(null, { status: 201 }); } });
  assert.equal(called, false);
});

test('알 수 없는 경로·메서드는 404', async () => {
  const env = newEnv();
  assert.equal((await handle(req('GET', '/nope'), env)).status, 404);
  assert.equal((await handle(req('GET', '/subscribe'), env)).status, 404);
  assert.equal((await handle(req('PATCH', '/subscribe/' + 'A'.repeat(32)), env)).status, 404);
});
