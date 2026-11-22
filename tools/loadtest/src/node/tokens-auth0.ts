/**
 * Spec 16 AC20, AC21 — `staging` / `prod` tokens come from Auth0's password-realm grant on the load-test connection
 * (§6.5), fetched once at run start, paced, retried on 429 / 5xx with backoff, and held in memory only. Errors name
 * the account's number, never its password, a secret or a token (AC22).
 */
import type { Secrets } from "./env.ts";
import { auth0ErrorCode, callSignal, retryAfterWaitMs } from "./http-limits.ts";

export interface Auth0Deps {
  fetchFn: typeof fetch;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Minor 587: one line for each `Retry-After` wait. */
  log(line: string): void;
}

export interface Auth0Opts {
  /** Seconds the tokens must stay valid from now (the run's estimate plus margin). */
  needS: number;
  perSecond?: number;
  maxAttempts?: number;
}

const PASSWORD_REALM = "http://auth0.com/oauth/grant-type/password-realm";

/** The payload's numeric `exp`, read without verifying the signature; `undefined` when it can't be read. */
export function tokenExpS(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

type Attempt = { token: string } | { retry: boolean; why: string; retryAfter?: string | null };

async function attempt(email: string, s: Secrets, fetchFn: typeof fetch): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetchFn(`https://${s.get("AUTH0_DOMAIN")}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: PASSWORD_REALM,
        username: email,
        password: s.get("LOADTEST_ACCOUNT_PASSWORD"),
        realm: s.get("LOADTEST_AUTH0_CONNECTION"),
        audience: s.get("AUTH0_AUDIENCE"),
        client_id: s.get("LOADTEST_AUTH0_CLIENT_ID"),
        client_secret: s.get("LOADTEST_AUTH0_CLIENT_SECRET"),
        scope: "openid",
      }),
      signal: callSignal(),
    });
  } catch {
    return { retry: true, why: "network error" };
  }
  let body: { access_token?: unknown; error?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    // Minor 604: on a 2xx the body is the token. One whose read fails (it stalls past the call's signal, or the
    // stream breaks) is a network problem, so retry it. A body that arrived whole but isn't JSON (a SyntaxError: a
    // proxy page, an Action's error) is deterministic, so it stays minor 590's final "no access_token".
    if (res.ok && !(err instanceof SyntaxError)) return { retry: true, why: `HTTP ${res.status}, body unreadable` };
    body = {};
  }
  if (res.ok && typeof body.access_token === "string" && body.access_token !== "") return { token: body.access_token };
  // Minor 590: a 2xx with no token is usually a deterministic Action error; retrying costs 15 s and five logins.
  if (res.ok) return { retry: false, why: `HTTP ${res.status}, no access_token` };
  if (res.status === 429 || res.status >= 500) return { retry: true, why: `HTTP ${res.status}`, retryAfter: res.headers.get("retry-after") };
  // Auth0's `error` is a fixed code (invalid_grant, unauthorized_client …); its description is free text, so it stays out.
  return { retry: false, why: `HTTP ${res.status}${auth0ErrorCode(body)}` };
}

function hours(s: number): string {
  return (s / 3600).toFixed(1);
}

export async function auth0Tokens(emails: string[], s: Secrets, deps: Auth0Deps, opts: Auth0Opts): Promise<string[]> {
  const perSecond = opts.perSecond ?? 2;
  const maxAttempts = opts.maxAttempts ?? 5;
  const gapMs = 1000 / perSecond;
  let lastStart: number | undefined;
  const tokens: string[] = [];

  for (const [i, email] of emails.entries()) {
    let token: string | undefined;
    for (let n = 1; token === undefined; n += 1) {
      if (lastStart !== undefined) {
        const wait = lastStart + gapMs - deps.now();
        if (wait > 0) await deps.sleep(wait);
      }
      lastStart = deps.now();
      const result = await attempt(email, s, deps.fetchFn);
      if ("token" in result) {
        token = result.token;
        break;
      }
      if (!result.retry) throw new Error(`token fetch failed for account #${i + 1} (${result.why})`);
      if (n >= maxAttempts) throw new Error(`token fetch failed for account #${i + 1} after ${maxAttempts} attempts (${result.why})`);
      await deps.sleep(retryAfterWaitMs(result.retryAfter ?? null, 2 ** (n - 1), deps.log));
    }

    if (i === 0) {
      const exp = tokenExpS(token);
      if (exp === undefined) throw new Error("Auth0 token has no readable exp");
      const leftS = exp - deps.now() / 1000;
      if (leftS < opts.needS) {
        throw new Error(
          `Auth0 tokens last ${hours(leftS)} h but this run needs ${hours(opts.needS)} h; raise the API's Token Expiration in Auth0 (runbook load-testing.md)`,
        );
      }
    }
    tokens.push(token);
  }
  return tokens;
}
