// 공고문 자격요건 AI 추출 1회 실행: 끝난 배치 결과 반영 → 새 대상 Batch 제출.
// AI_EXTRACT_ENABLED=true + ANTHROPIC_API_KEY 필요(없으면 아무것도 하지 않고 종료). 수집(npm run collect) 끝에도 자동 실행됨.
import { createSqliteDb, migrate } from "../src/server/db";
import { runAiCycle, aiStatus } from "../src/server/ai-extract";

const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
console.log(JSON.stringify(await runAiCycle(db)));
const s = await aiStatus(db);
console.log(`AI 추출 현황: 완료 ${s.counts.ok} · 대기 ${s.counts.pending} · 실패 ${s.counts.failed} · 이번 달 $${s.monthSpentUsd.toFixed(2)} / $${s.monthlyBudgetUsd}`);
