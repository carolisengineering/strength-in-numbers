import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAnnotation, openAnnotation } from "../src/node/annotate.ts";
import { ANNOTATION_SECRETS, RUN_SECRETS, SETUP_SECRETS, secretsFrom } from "../src/node/env.ts";
import { CALL_TIMEOUT_MS, RETRY_AFTER_CAP_S, callSignal, retryAfterWaitMs } from "../src/node/http-limits.ts";
import { mgmtClient } from "../src/node/setup-accounts.ts";
import { auth0Tokens } from "../src/node/tokens-auth0.ts";

afterEach(() => vi.restoreAllMocks());

const timedOut = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

/** A fetch that records each call's signal; `answer` decides each reply by call number. */
function recordingFetch(answer: (n: number, url: string) => Response | Error) {
  const signals: (AbortSignal | null | undefined)[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    signals.push(init?.signal);
    const a = answer(signals.length - 1, String(url));
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { fetchFn, signals };
}

const jwt = (exp: number) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;

describe("minor 585 — every Grafana and Auth0 call times out after 10 s", () => {
  it("callSignal is a 10 s timeout", () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    callSignal();
    expect(CALL_TIMEOUT_MS).toBe(10_000);
    expect(spy).toHaveBeenCalledWith(10_000);
  });

  it("Grafana: both annotation calls carry a signal, and a timeout is the usual warning", async () => {
    const s = secretsFrom({ GRAFANA_URL: "https://stack.grafana.example.test", GRAFANA_ANNOTATION_TOKEN: "glsa_x" }, ANNOTATION_SECRETS);
    const ok = recordingFetch(() => Response.json({ id: 42 }));
    await openAnnotation(s, { target: "staging", type: "gym", startMs: 1 }, ok.fetchFn, () => {});
    await closeAnnotation(s, 42, { endMs: 2, text: "t" }, ok.fetchFn, () => {});
    expect(ok.signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
    expect(ok.signals).toHaveLength(2);

    const hung = recordingFetch(() => timedOut());
    const warnings: string[] = [];
    await expect(openAnnotation(s, { target: "staging", type: "gym", startMs: 1 }, hung.fetchFn, (l) => void warnings.push(l))).resolves.toBeUndefined();
    expect(warnings).toEqual(["Grafana annotation: opening the run annotation failed (network error); the run goes on"]);
  });

  it("Auth0 tokens: each attempt carries a signal, and a timeout is retried like a network error", async () => {
    const s = secretsFrom(
      {
        AUTH0_DOMAIN: "tenant.example.test",
        AUTH0_AUDIENCE: "https://api.example.test",
        LOADTEST_AUTH0_CLIENT_ID: "cid",
        LOADTEST_AUTH0_CLIENT_SECRET: "csecret",
        LOADTEST_AUTH0_CONNECTION: "loadtest",
        LOADTEST_ACCOUNT_PASSWORD: "pw",
      },
      RUN_SECRETS,
    );
    const { fetchFn, signals } = recordingFetch((n) => (n === 0 ? timedOut() : Response.json({ access_token: jwt(4_000_000_000) })));
    const sleeps: number[] = [];
    let nowMs = 0;
    const deps = { fetchFn, sleep: async (ms: number) => void (sleeps.push(ms), (nowMs += ms)), now: () => nowMs, log: () => {} };
    const tokens = await auth0Tokens(["loadtest+001@example.test"], s, deps, { needS: 60 });
    expect(tokens).toHaveLength(1);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
    expect(sleeps).toEqual([1000]);
  });

  it("Management API: requests carry a signal, and a timeout names the path", async () => {
    const s = secretsFrom({ AUTH0_DOMAIN: "tenant.example.test", AUTH0_MGMT_CLIENT_ID: "mid", AUTH0_MGMT_CLIENT_SECRET: "msecret", LOADTEST_AUTH0_CONNECTION: "loadtest", LOADTEST_ACCOUNT_PASSWORD: "pw" }, SETUP_SECRETS);
    const { fetchFn, signals } = recordingFetch((_n, url) => (url.endsWith("/oauth/token") ? Response.json({ access_token: "mgmt-token" }) : timedOut()));
    const client = mgmtClient(s, { fetchFn, sleep: async () => {}, now: () => 0 });
    await expect(client.listConnectionEmails("loadtest")).rejects.toThrow("Auth0 Management API: no answer from /api/v2/users (timeout or network error)");
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
  });
});

describe("minor 587 — Retry-After is capped at 60 s and logged", () => {
  const run = (header: string | null) => {
    const log: string[] = [];
    return { ms: retryAfterWaitMs(header, 2, (l) => void log.push(l)), log };
  };

  it("a long wait is cut to the cap, with one line saying so", () => {
    expect(RETRY_AFTER_CAP_S).toBe(60);
    expect(run("600")).toEqual({ ms: 60_000, log: ["Auth0 asked to wait 600 s; waiting 60 s"] });
  });

  it("a short wait is kept, and still logged", () => {
    expect(run("3")).toEqual({ ms: 3_000, log: ["Auth0 asked to wait 3 s"] });
  });

  it("Review Focus 1: an HTTP-date, 0, a negative or a missing header falls back, with no line", () => {
    for (const header of ["Wed, 21 Oct 2026 07:28:00 GMT", "0", "-5", null]) expect(run(header), String(header)).toEqual({ ms: 2_000, log: [] });
  });
});
