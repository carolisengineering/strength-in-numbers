/**
 * Post-deploy smoke (Spec 01 §10, criterion 12). Run against staging after
 * Render finishes deploying the pushed SHA.
 *
 *   1. /healthz            → 200
 *   2. /readyz             → 200        (this is how /readyz gates the release)
 *   3. M2M client-credentials grant against Auth0
 *   4. GET /v1/_authcheck  → 200, aud matches AUTH0_M2M_AUDIENCE
 *   5. GET /v1/me          → 401 invalid-token (no email claim on an M2M token)
 *
 * Any non-conforming result exits non-zero and fails the pipeline.
 */

const BASE = requireEnv("SMOKE_BASE_URL").replace(/\/$/, "");
const TOKEN_URL = requireEnv("AUTH0_TOKEN_URL");
const CLIENT_ID = requireEnv("AUTH0_M2M_CLIENT_ID");
const CLIENT_SECRET = requireEnv("AUTH0_M2M_CLIENT_SECRET");
const AUDIENCE = requireEnv("AUTH0_M2M_AUDIENCE");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`smoke: missing env ${name}\n`);
    process.exit(1);
  }
  return v;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    process.stderr.write(`smoke: FAIL — ${msg}\n`);
    process.exit(1);
  }
  process.stdout.write(`smoke: ok — ${msg}\n`);
}

async function waitForHealthy(attempts = 30, delayMs = 10_000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    process.stdout.write(`smoke: waiting for /healthz (${i}/${attempts})\n`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  process.stderr.write("smoke: FAIL — /healthz never returned 200\n");
  process.exit(1);
}

async function getM2MToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: AUDIENCE,
    }),
  });
  assert(res.status === 200, `client-credentials grant returned ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  assert(typeof body.access_token === "string", "grant response has access_token");
  return body.access_token!;
}

async function main(): Promise<void> {
  await waitForHealthy();

  const ready = await fetch(`${BASE}/readyz`);
  assert(ready.status === 200, `/readyz → ${ready.status} (expected 200)`);

  const token = await getM2MToken();
  const authHeader = { authorization: `Bearer ${token}` };

  const authcheck = await fetch(`${BASE}/v1/_authcheck`, { headers: authHeader });
  assert(authcheck.status === 200, `/v1/_authcheck → ${authcheck.status} (expected 200)`);
  const claims = (await authcheck.json()) as { aud?: unknown };
  const audOk =
    claims.aud === AUDIENCE ||
    (Array.isArray(claims.aud) && claims.aud.includes(AUDIENCE));
  assert(audOk, `/v1/_authcheck aud includes ${AUDIENCE}`);

  const me = await fetch(`${BASE}/v1/me`, { headers: authHeader });
  assert(me.status === 401, `/v1/me → ${me.status} (expected 401, no email claim)`);
  const problem = (await me.json()) as { type?: string };
  assert(
    typeof problem.type === "string" && problem.type.includes("invalid-token"),
    `/v1/me problem type is invalid-token (got ${String(problem.type)})`,
  );

  process.stdout.write("smoke: PASS\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `smoke: FAIL — ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
