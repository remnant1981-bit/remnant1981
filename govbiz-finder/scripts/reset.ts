import fs from "node:fs";
const f = process.env.DATABASE_PATH || "./data/dev.sqlite";
for (const s of ["", "-wal", "-shm"]) fs.rmSync(f + s, { force: true });
console.log("removed", f);
