// R&D 사업비 계산기 Pro 이용권 발급 도구(운영자 PC 전용).
//   키 생성(최초 1회): node scripts/rnd-budget/license.mjs keygen
//     → 개인키를 ~/.rnd-budget/private.jwk 에 저장(권한 600), 공개키 JWK 출력 → rnd-budget/config.js licensePublicKey 에 붙여 넣기
//   발급:            node scripts/rnd-budget/license.mjs issue <주문번호> [이용일수=365]
//     → 구매자에게 보낼 코드 출력
// 개인키는 저장소·메일·메신저에 절대 올리지 말 것(유출 시 keygen 다시 실행 → 새 공개키 배포, 기존 코드는 무효).
import { webcrypto as wc } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_PATH = process.env.RB_PRIVATE_KEY || join(homedir(), '.rnd-budget', 'private.jwk');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function keygen(path = KEY_PATH, force = false) {
  if (existsSync(path) && !force) throw new Error(`이미 개인키가 있습니다: ${path} (새로 만들면 기존 코드가 모두 무효 → --force)`);
  const kp = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await wc.subtle.exportKey('jwk', kp.privateKey);
  const pub = await wc.subtle.exportKey('jwk', kp.publicKey);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(priv), { mode: 0o600 });
  return { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };
}

export async function issue(id, days = 365, path = KEY_PATH, start = today()) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) throw new Error('주문번호는 영문·숫자·-·_ 1~40자');
  if (!Number.isInteger(days) || days < 1 || days > 3660) throw new Error('이용일수는 1~3660');
  const jwk = JSON.parse(readFileSync(path, 'utf8'));
  const key = await wc.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const exp = addDays(start, days - 1);
  const payload = b64u(JSON.stringify({ id: String(id), exp, plan: 'pro' }));
  const sig = await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payload));
  return { code: `${payload}.${b64u(sig)}`, exp };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'keygen') {
      const pub = await keygen(KEY_PATH, process.argv.includes('--force'));
      console.log(`개인키 저장: ${KEY_PATH}\nconfig.js licensePublicKey 에 붙여 넣을 공개키:\n${JSON.stringify(pub)}`);
    } else if (cmd === 'issue' && a) {
      const r = await issue(a, b ? Number(b) : 365);
      console.log(`이용 종료일: ${r.exp}\n${r.code}`);
    } else {
      console.log('사용법: keygen | issue <주문번호> [이용일수]');
      process.exitCode = 1;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
