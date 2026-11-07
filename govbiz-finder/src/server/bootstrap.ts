import bcrypt from "bcryptjs";
import { newId, randomToken } from "@/lib/crypto";
import { nowIso, seoulToday } from "@/lib/time";
import type { Db } from "./db";
import { seedReference } from "./seed-data";
import { MockAdapter } from "@/collector/mock-adapter";
import { runSource } from "@/collector/runner";

/** 참조 데이터 + 모의 공고 + (선택) 관리자 계정 시드. 개발/테스트 전용 모의 데이터는 '테스트 데이터'로 표시된다. */
export async function seedAll(db: Db, opts: { adminEmail?: string; adminPassword?: string; withMock?: boolean } = {}) {
  await seedReference(db);
  let adminPassword: string | undefined;
  if (opts.adminEmail) {
    const exists = await db.get("SELECT id FROM users WHERE email=?", [opts.adminEmail]);
    if (!exists) {
      adminPassword = opts.adminPassword || randomToken(12) + "a1";
      const now = nowIso();
      await db.run("INSERT INTO users(id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?, 'admin','active',?,?)",
        [newId(), opts.adminEmail, await bcrypt.hash(adminPassword, Number(process.env.BCRYPT_COST || 12)), now, now]);
    }
  }
  if (opts.withMock !== false) await runSource(db, new MockAdapter(seoulToday()));
  return { adminPassword };
}
