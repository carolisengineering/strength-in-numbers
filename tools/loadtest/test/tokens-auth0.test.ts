import { describe, expect, it } from "vitest";
import { RUN_SECRETS, secretsFrom } from "../src/node/env.ts";
import { auth0Tokens, tokenExpS } from "../src/node/tokens-auth0.ts";

const s = secretsFrom(
  {
    AUTH0_DOMAIN: "tenant.example.test",
    AUTH0_AUDIENCE: "https://api.example.test",
    LOADTEST_AUTH0_CLIENT_ID: "client-id-1",
    LOADTEST_AUTH0_CLIENT_SECRET: "client-secret-xyz",
    LOADTEST_AUTH0_CONNECTION: "loadtest",
    LOADTEST_ACCOUNT_PASSWORD: "hunter2-password",
  },
  RUN_SECRETS,
);

const START_MS = 1_800_000_000_000;
const jwt = (payload: unknown) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const DAY = 86_400;
const goodToken = (i = 0) => jwt({ exp: START_MS / 1000 + DAY, n: i });

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fake fetch answering from a script (by call order) and a clock that only `sleep` moves. */
function harness(script: (call: number, body: Record<string, unknown>) => Reply) {
  let nowMs = START_MS;
  const calls: { at: number; url: string; body: Record<string, unknown> }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ at: nowMs, url, body });
    const reply = script(calls.length - 1, body);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: reply.headers });
  }) as unknown as typeof fetch;
  const deps = {
    fetchFn,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    now: () => nowMs,
    log: (line: string) => void logs.push(line),
  };
  return { deps, calls, sleeps, logs };
}

const emails = (n: number) => Array.from({ length: n }, (_, i) => `loadtest+${String(i + 1).padStart(3, "0")}@example.test`);
const ok = (i: number): Reply => ({ status: 200, body: { access_token: goodToken(i), token_type: "Bearer" } });

describe("AC21 — tokens are fetched politely", () => {
  it("returns one token per account, in order", async () => {
    const h = harness((i) => ok(i));
    const tokens = await auth0Tokens(emails(3), s, h.deps, { needS: 3600 });
    expect(tokens).toEqual([goodToken(0), goodToken(1), goodToken(2)]);
  });

  it("paces 6 accounts at 2 per second: at least 2.5 s from the first request to the last", async () => {
    const h = harness((i) => ok(i));
    await auth0Tokens(emails(6), s, h.deps, { needS: 3600 });
    expect(h.calls.at(-1)!.at - h.calls[0]!.at).toBeGreaterThanOrEqual(2500);
  });

  it("posts the password-realm grant with exactly the expected keys", async () => {
    const h = harness((i) => ok(i));
    await auth0Tokens(emails(1), s, h.deps, { needS: 3600 });
    expect(h.calls[0]!.url).toBe("https://tenant.example.test/oauth/token");
    expect(h.calls[0]!.body).toEqual({
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      username: "loadtest+001@example.test",
      password: "hunter2-password",
      realm: "loadtest",
      audience: "https://api.example.test",
      client_id: "client-id-1",
      client_secret: "client-secret-xyz",
      scope: "openid",
    });
  });

  it("a 429 then a 200 succeeds after a 1 s wait", async () => {
    const h = harness((i) => (i === 0 ? { status: 429 } : ok(0)));
    await auth0Tokens(emails(1), s, h.deps, { needS: 3600 });
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toContain(1000);
  });

  it("honors Retry-After on a 429", async () => {
    const h = harness((i) => (i === 0 ? { status: 429, headers: { "retry-after": "7" } } : ok(0)));
    await auth0Tokens(emails(1), s, h.deps, { needS: 3600 });
    expect(h.sleeps).toContain(7000);
  });

  it("backs off 1, 2, 4, 8 s and aborts after five 503s, naming the account and no secret", async () => {
    const h = harness((_, body) => (body.username === "loadtest+003@example.test" ? { status: 503 } : ok(0)));
    const err = await auth0Tokens(emails(4), s, h.deps, { needS: 3600 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("token fetch failed for account #3 after 5 attempts (HTTP 503)");
    for (const v of s.values()) expect((err as Error).message).not.toContain(v);
    for (const ms of [1000, 2000, 4000, 8000]) expect(h.sleeps).toContain(ms);
    expect(h.calls.filter((c) => c.body.username === "loadtest+004@example.test")).toHaveLength(0);
  });

  it("a network error is retried like a 5xx", async () => {
    const h = harness((i) => (i === 0 ? new TypeError("fetch failed") : ok(0)));
    await expect(auth0Tokens(emails(1), s, h.deps, { needS: 3600 })).resolves.toHaveLength(1);
  });

  it("a 403 (wrong password) aborts at once with Auth0's error code, never its description", async () => {
    const h = harness(() => ({ status: 403, body: { error: "invalid_grant", error_description: "Wrong email or password." } }));
    await expect(auth0Tokens(emails(2), s, h.deps, { needS: 3600 })).rejects.toThrow(
      /^token fetch failed for account #1 \(HTTP 403 invalid_grant\)$/,
    );
    expect(h.calls).toHaveLength(1);
  });

  it("minor 590 — a 2xx with no token isn't retried: one attempt, then the error", async () => {
    const h = harness(() => ({ status: 200, body: { error: "access_denied" } }));
    await expect(auth0Tokens(emails(1), s, h.deps, { needS: 3600 })).rejects.toThrow(/^token fetch failed for account #1 \(HTTP 200, no access_token\)$/);
    expect(h.calls).toHaveLength(1);
  });

  it("minor 587 — a Retry-After of 600 s waits 60 s and says so once", async () => {
    const h = harness((i) => (i === 0 ? { status: 429, headers: { "retry-after": "600" } } : ok(0)));
    await auth0Tokens(emails(1), s, h.deps, { needS: 3600 });
    expect(h.sleeps).toEqual([60_000]);
    expect(h.logs).toEqual(["Auth0 asked to wait 600 s; waiting 60 s"]);
  });
});

describe("token lifetime (refresh design 2026-11-14)", () => {
  it("refuses tokens that end before the run, after exactly one fetch, without printing the token", async () => {
    const short = jwt({ exp: START_MS / 1000 + 3600 });
    const h = harness(() => ({ status: 200, body: { access_token: short } }));
    const err = await auth0Tokens(emails(3), s, h.deps, { needS: 7200 }).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "Auth0 tokens last 1.0 h but this run needs 2.0 h; raise the API's Token Expiration in Auth0 (runbook load-testing.md)",
    );
    expect((err as Error).message).not.toContain(short);
    expect(h.calls).toHaveLength(1);
  });

  it("accepts a 24 h token for a 6 h run", async () => {
    const h = harness((i) => ok(i));
    await expect(auth0Tokens(emails(2), s, h.deps, { needS: 6 * 3600 })).resolves.toHaveLength(2);
  });

  it("refuses a token with no readable exp", async () => {
    const h = harness(() => ({ status: 200, body: { access_token: "not-a-jwt" } }));
    await expect(auth0Tokens(emails(1), s, h.deps, { needS: 60 })).rejects.toThrow("Auth0 token has no readable exp");
  });

  it("tokenExpS reads a numeric exp and nothing else", () => {
    expect(tokenExpS(jwt({ exp: 123 }))).toBe(123);
    expect(tokenExpS(jwt({ exp: "123" }))).toBeUndefined();
    expect(tokenExpS(jwt({}))).toBeUndefined();
    expect(tokenExpS("not-a-jwt")).toBeUndefined();
    expect(tokenExpS("a.%%%.c")).toBeUndefined();
  });
});
