// Web Crypto 기반(Node·Cloudflare Workers 공통). 키는 환경변수에서만 읽는다.
import fs from "node:fs";
import path from "node:path";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64");
}
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const b = Buffer.from(s, "base64");
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
}

type KeyName = "APP_ENCRYPTION_KEY" | "APP_HMAC_KEY" | "APP_SESSION_PEPPER";

let devKeys: Record<string, string> | undefined;
function secret(name: KeyName): string {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`필수 환경변수 ${name} 가 설정되지 않았습니다(.env.example 참고).`);
  }
  // 개발 전용: data/.devkeys 에 자동 생성(저장소 커밋 제외). 운영에서는 사용되지 않음.
  if (!devKeys) {
    const f = path.resolve(process.cwd(), "data", ".devkeys.json");
    try {
      devKeys = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      devKeys = {};
    }
    let changed = false;
    for (const k of ["APP_ENCRYPTION_KEY", "APP_HMAC_KEY", "APP_SESSION_PEPPER"]) {
      if (!devKeys![k]) {
        devKeys![k] = b64(crypto.getRandomValues(new Uint8Array(32)));
        changed = true;
      }
    }
    if (changed) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(devKeys), { mode: 0o600 });
    }
  }
  return devKeys![name];
}

async function aesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret("APP_ENCRYPTION_KEY")));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptText(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(plain));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptText(token: string): Promise<string> {
  const [v, iv, ct] = token.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("invalid ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ct));
  return dec.decode(pt);
}

export async function hmacHex(name: KeyName, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret(name)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Buffer.from(sig).toString("hex");
}

export async function sha256Hex(message: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", enc.encode(message))).toString("hex");
}

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export function newId(): string {
  // 시간순 정렬 가능한 ULID 유사 ID: 48bit 시간(hex) + 80bit 랜덤
  const t = Date.now().toString(16).padStart(12, "0");
  const r = Buffer.from(crypto.getRandomValues(new Uint8Array(10))).toString("hex");
  return t + r;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 사업자번호 정규화(숫자 10자리). 형식이 맞지 않으면 null. */
export function normalizeBizNo(input: string): string | null {
  const d = input.replace(/[^0-9]/g, "");
  return d.length === 10 ? d : null;
}

/** 사업자번호 체크섬 검증(국세청 규칙). */
export function isValidBizNoChecksum(d: string): boolean {
  if (!/^\d{10}$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

export function maskBizNo(d: string): string {
  return `${d.slice(0, 3)}-**-***${d.slice(8)}`;
}
