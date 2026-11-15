import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accountEmail, accountIds } from "../src/node/accounts.ts";
import { parseArgs } from "../src/node/args.ts";
import { SETUP_SECRETS, loadSecrets, secretsFrom } from "../src/node/env.ts";
import { mgmtClient, setupAccounts, type MgmtClient } from "../src/node/setup-accounts.ts";

const s = secretsFrom(
  {
    AUTH0_DOMAIN: "tenant.example.test",
    LOADTEST_AUTH0_CONNECTION: "loadtest",
    LOADTEST_ACCOUNT_PASSWORD: "hunter2-password",
    AUTH0_MGMT_CLIENT_ID: "mgmt-id",
    AUTH0_MGMT_CLIENT_SECRET: "mgmt-secret-xyz",
  },
  SETUP_SECRETS,
);

function fakeClient(existing: string[]) {
  const have = new Set(existing);
  const created: { connection: string; email: string; password: string; email_verified: true }[] = [];
  const client: MgmtClient = {
    listConnectionEmails: async () => new Set(have),
    createUser: async (body) => {
      created.push(body);
      if (have.has(body.email)) return "exists";
      have.add(body.email);
      return "created";
    },
  };
  return { client, created };
}

const emails = (n: number) => accountIds(n).map(accountEmail);

describe("AC19 — setup-accounts", () => {
  it("creates only the missing accounts, verified, on the load-test connection", async () => {
    const { client, created } = fakeClient(emails(2));
    const lines: string[] = [];
    expect(await setupAccounts(5, client, s, { dryRun: false, log: (l) => lines.push(l) })).toEqual({ created: 3, existing: 2 });
    expect(created.map((c) => c.email)).toEqual(emails(5).slice(2));
    for (const body of created) {
      expect(body).toEqual({ connection: "loadtest", email: body.email, password: "hunter2-password", email_verified: true });
    }
    expect(lines).toContain("created 3, existing 2");
  });

  it("a second run creates nothing", async () => {
    const { client, created } = fakeClient([]);
    await setupAccounts(5, client, s, { dryRun: false, log: () => {} });
    created.length = 0;
    expect(await setupAccounts(5, client, s, { dryRun: false, log: () => {} })).toEqual({ created: 0, existing: 5 });
    expect(created).toHaveLength(0);
  });

  it("--dry-run creates nothing and says what it would do", async () => {
    const { client, created } = fakeClient(emails(2));
    const lines: string[] = [];
    expect(await setupAccounts(5, client, s, { dryRun: true, log: (l) => lines.push(l) })).toEqual({ created: 0, existing: 2 });
    expect(created).toHaveLength(0);
    expect(lines).toContain("would create 3");
  });

  it("an account the search index hasn't caught up with counts as existing when Auth0 says so", async () => {
    const { client } = fakeClient(emails(1));
    const lagging: MgmtClient = { ...client, listConnectionEmails: async () => new Set() };
    expect(await setupAccounts(2, lagging, s, { dryRun: false, log: () => {} })).toEqual({ created: 1, existing: 1 });
  });

  it("refuses to run without its Management credentials, naming the variable", () => {
    const dir = mkdtempSync(join(tmpdir(), "loadtest-setup-"));
    const path = join(dir, ".env.loadtest");
    writeFileSync(path, "AUTH0_DOMAIN=t\nLOADTEST_AUTH0_CONNECTION=loadtest\nLOADTEST_ACCOUNT_PASSWORD=p\nAUTH0_MGMT_CLIENT_ID=id\n");
    expect(() => loadSecrets(path, SETUP_SECRETS)).toThrow("missing AUTH0_MGMT_CLIENT_SECRET in tools/loadtest/.env.loadtest");
  });

  it("the client has no way to update or delete a user", () => {
    const { client } = fakeClient([]);
    // @ts-expect-error — MgmtClient has no deleteUser (AC19: never edits or deletes)
    expect(client.deleteUser).toBeUndefined();
    // @ts-expect-error — and no updateUser
    expect(client.updateUser).toBeUndefined();
  });

  it("parses `setup-accounts [--count N] [--dry-run]`, defaulting to 150", () => {
    expect(parseArgs(["setup-accounts"])).toEqual({ cmd: "setup-accounts", count: 150, dryRun: false });
    expect(parseArgs(["setup-accounts", "--count", "5", "--dry-run"])).toEqual({ cmd: "setup-accounts", count: 5, dryRun: true });
    expect(() => parseArgs(["setup-accounts", "--target", "staging"])).toThrow(/unknown flag --target/);
  });
});

/** A fake Management API: a token endpoint, a paged user search, and user creation. */
function fakeMgmt(total: number, opts: { createStatus?: number } = {}) {
  const requests: { method: string; url: URL; body?: Record<string, unknown>; auth?: string | null }[] = [];
  const users = emails(total);
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method, url, body, auth: new Headers(init?.headers).get("authorization") });
    if (url.pathname === "/oauth/token") return Response.json({ access_token: "mgmt-token", token_type: "Bearer" });
    if (method === "GET" && url.pathname === "/api/v2/users") {
      const page = Number(url.searchParams.get("page"));
      const per = Number(url.searchParams.get("per_page"));
      return Response.json(users.slice(page * per, (page + 1) * per).map((email) => ({ email })));
    }
    if (method === "POST" && url.pathname === "/api/v2/users") {
      return Response.json({ statusCode: opts.createStatus ?? 201 }, { status: opts.createStatus ?? 201 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const deps = { fetchFn, sleep: async () => {}, now: () => 0 };
  return { deps, requests };
}

describe("AC19 — the Management client", () => {
  it("Review Focus 3 — reads every page of the connection's users (100 + 50)", async () => {
    const { deps, requests } = fakeMgmt(150);
    const found = await mgmtClient(s, deps).listConnectionEmails("loadtest");
    expect(found.size).toBe(150);
    const searches = requests.filter((r) => r.url.pathname === "/api/v2/users");
    expect(searches.map((r) => r.url.searchParams.get("page"))).toEqual(["0", "1"]);
    expect(searches[0]!.url.searchParams.get("q")).toBe('identities.connection:"loadtest"');
    expect(searches[0]!.url.searchParams.get("search_engine")).toBe("v3");
    expect(searches[0]!.auth).toBe("Bearer mgmt-token");
  });

  it("asks for a Management token with client credentials for the tenant's /api/v2/ audience", async () => {
    const { deps, requests } = fakeMgmt(0);
    await mgmtClient(s, deps).listConnectionEmails("loadtest");
    expect(requests[0]!.body).toEqual({
      grant_type: "client_credentials",
      client_id: "mgmt-id",
      client_secret: "mgmt-secret-xyz",
      audience: "https://tenant.example.test/api/v2/",
    });
  });

  it("creates a user with POST /api/v2/users; a 409 means it already exists", async () => {
    const created = fakeMgmt(0);
    const body = { connection: "loadtest", email: "loadtest+001@example.test", password: "p", email_verified: true as const };
    expect(await mgmtClient(s, created.deps).createUser(body)).toBe("created");
    expect(created.requests.at(-1)).toMatchObject({ method: "POST", body });
    expect(await mgmtClient(s, fakeMgmt(0, { createStatus: 409 }).deps).createUser(body)).toBe("exists");
  });

  it("any other failure names the status, never a secret or the password", async () => {
    const body = { connection: "loadtest", email: "loadtest+001@example.test", password: "hunter2-password", email_verified: true as const };
    const err = await mgmtClient(s, fakeMgmt(0, { createStatus: 400 }).deps)
      .createUser(body)
      .catch((e: Error) => e);
    expect((err as Error).message).toBe("Auth0 Management API: creating loadtest+001@example.test answered HTTP 400");
    for (const v of s.values()) expect((err as Error).message).not.toContain(v);
  });
});
