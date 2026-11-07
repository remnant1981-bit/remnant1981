import { createSqliteDb, migrate, setDb, type Db } from "@/server/db";
import { seedAll } from "@/server/bootstrap";
import { seoulToday } from "@/lib/time";

export const TODAY = seoulToday();

export async function freshDb(opts: { mock?: boolean; admin?: boolean } = {}): Promise<Db> {
  const db = await createSqliteDb(":memory:");
  await migrate(db);
  await seedAll(db, { withMock: opts.mock !== false, adminEmail: opts.admin ? "admin@example.test" : undefined, adminPassword: "AdminPass12345" });
  setDb(db);
  return db;
}

export interface Client {
  cookie: string;
  csrf: string;
  call(method: string, path: string, body?: unknown, h?: Record<string, string>): Promise<{ status: number; body: any; res: Response }>;
}
export async function client(handlers: Record<string, (req: Request, ...a: any[]) => Promise<Response>>): Promise<Client> {
  const c: Client = {
    cookie: "",
    csrf: "",
    async call(method, path, body, h = {}) {
      const clean = path.split("?")[0];
      let handler: ((req: Request, ...a: any[]) => Promise<Response>) | undefined;
      let params: Record<string, string> = {};
      for (const k of Object.keys(handlers)) {
        const [m, pat] = k.split(" ");
        if (m !== method) continue;
        const names: string[] = [];
        const re = new RegExp("^" + pat.replace(/:(\w+)/g, (_x, n) => { names.push(n); return "([^/]+)"; }) + "$");
        const mm = clean.match(re);
        if (mm) { handler = handlers[k]; params = Object.fromEntries(names.map((n, i) => [n, mm[i + 1]])); break; }
      }
      if (!handler) throw new Error("no handler " + method + " " + clean);
      const headers: Record<string, string> = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", ...h };
      if (c.cookie) headers.cookie = c.cookie;
      if (c.csrf && !("x-csrf-token" in h)) headers["x-csrf-token"] = c.csrf;
      const req = new Request("http://localhost:3000" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const res = await handler(req, { params: Promise.resolve(params) });
      const sc = res.headers.get("set-cookie");
      if (sc && /gbf_session=[^;]+/.test(sc)) c.cookie = sc.match(/gbf_session=[^;]*/)![0].replace(/^gbf_session=$/, "");
      if (sc && sc.includes("Max-Age=0")) c.cookie = "";
      const ct = res.headers.get("content-type") ?? "";
      const parsed = ct.includes("json") ? await res.clone().json() : null;
      if (parsed?.csrf) c.csrf = parsed.csrf;
      return { status: res.status, body: parsed, res };
    },
  };
  return c;
}
