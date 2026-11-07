import { createSqliteDb, migrate } from "../src/server/db";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
console.log("applied:", await migrate(db));
