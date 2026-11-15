/**
 * Spec 16 AC19 — `setup-accounts` creates the load-test accounts that are missing, on the load-test connection only,
 * and nothing else. The Management client can list that connection's users and create one; it has no update or
 * delete method at all, so the tool can't change a real user (§7). Requests are paced (2 a second) and a 429 waits.
 */
import { accountEmail, accountIds } from "./accounts.ts";
import type { Secrets } from "./env.ts";

export interface NewUser {
  connection: string;
  email: string;
  password: string;
  email_verified: true;
}

export interface MgmtClient {
  listConnectionEmails(connection: string): Promise<Set<string>>;
  /** "exists" when Auth0 answers 409 (the search index can lag behind a just-created user). */
  createUser(body: NewUser): Promise<"created" | "exists">;
}

export interface MgmtDeps {
  fetchFn: typeof fetch;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const PER_PAGE = 100;
const GAP_MS = 500;
const MAX_429_RETRIES = 4;

export function mgmtClient(s: Secrets, deps: MgmtDeps): MgmtClient {
  const base = `https://${s.get("AUTH0_DOMAIN")}`;
  let lastStart: number | undefined;
  let token: string | undefined;

  async function send(url: string, init: RequestInit): Promise<Response> {
    for (let n = 0; ; n += 1) {
      if (lastStart !== undefined) {
        const wait = lastStart + GAP_MS - deps.now();
        if (wait > 0) await deps.sleep(wait);
      }
      lastStart = deps.now();
      const res = await deps.fetchFn(url, init);
      if (res.status !== 429 || n >= MAX_429_RETRIES) return res;
      const after = Number(res.headers.get("retry-after"));
      await deps.sleep((Number.isFinite(after) && after > 0 ? after : 1) * 1000);
    }
  }

  async function authed(path: string, init: RequestInit = {}): Promise<Response> {
    if (token === undefined) {
      const res = await send(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: s.get("AUTH0_MGMT_CLIENT_ID"),
          client_secret: s.get("AUTH0_MGMT_CLIENT_SECRET"),
          audience: `${base}/api/v2/`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: unknown };
      if (!res.ok || typeof body.access_token !== "string") {
        throw new Error(`Auth0 Management API: the token request answered HTTP ${res.status}`);
      }
      token = body.access_token;
    }
    return send(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
    });
  }

  return {
    async listConnectionEmails(connection) {
      const found = new Set<string>();
      for (let page = 0; ; page += 1) {
        const q = new URLSearchParams({
          q: `identities.connection:"${connection}"`,
          search_engine: "v3",
          per_page: String(PER_PAGE),
          page: String(page),
          fields: "email",
        });
        const res = await authed(`/api/v2/users?${q}`);
        if (!res.ok) throw new Error(`Auth0 Management API: listing users answered HTTP ${res.status}`);
        const users = (await res.json()) as { email?: unknown }[];
        for (const u of users) if (typeof u.email === "string") found.add(u.email.toLowerCase());
        if (users.length < PER_PAGE) return found;
      }
    },
    async createUser(body) {
      const res = await authed("/api/v2/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) return "exists";
      if (!res.ok) throw new Error(`Auth0 Management API: creating ${body.email} answered HTTP ${res.status}`);
      return "created";
    },
  };
}

export async function setupAccounts(
  count: number,
  client: MgmtClient,
  s: Secrets,
  opts: { dryRun: boolean; log(line: string): void },
): Promise<{ created: number; existing: number }> {
  const connection = s.get("LOADTEST_AUTH0_CONNECTION");
  const have = await client.listConnectionEmails(connection);
  // A wrong connection name (the real users' one) must never get shared-password accounts: anything on it that isn't a
  // load-test account stops the command. The count is printed, never an address.
  const strangers = [...have].filter((email) => !/^loadtest\+\d{3,}@example\.test$/.test(email)).length;
  if (strangers > 0) {
    throw new Error(
      `connection "${connection}" holds ${strangers} account${strangers === 1 ? " that isn't a load-test account" : "s that aren't load-test accounts"}; ` +
        "LOADTEST_AUTH0_CONNECTION must name the dedicated load-test connection (runbook load-testing.md §2.2)",
    );
  }
  const wanted = accountIds(count).map(accountEmail);
  const missing = wanted.filter((email) => !have.has(email));
  let existing = wanted.length - missing.length;
  if (opts.dryRun) {
    opts.log(`would create ${missing.length}`);
    return { created: 0, existing };
  }
  let created = 0;
  const password = s.get("LOADTEST_ACCOUNT_PASSWORD");
  for (const email of missing) {
    const outcome = await client.createUser({ connection, email, password, email_verified: true });
    if (outcome === "created") created += 1;
    else existing += 1;
  }
  opts.log(`created ${created}, existing ${existing}`);
  return { created, existing };
}
