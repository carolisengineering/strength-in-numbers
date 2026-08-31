/**
 * Local IdP stand-in for manual auth testing — NOT for production.
 *
 * Serves a JWKS and mints RS256 access tokens shaped like the ones the Auth0
 * post-login Action produces (namespaced `email` / `email_verified` claims), so
 * you can exercise the real verify → provision → route path with curl before any
 * Auth0 tenant exists.
 *
 *   pnpm --filter @sin/api dev:idp
 *
 * Endpoints (default http://localhost:9999):
 *   GET /.well-known/jwks.json        the signing key set (point AUTH0_ISSUER here)
 *   GET /token                        mint a user token; query: sub, email,
 *                                     email_verified=false, no_email=1, expires_in
 *   GET /                             this help
 *
 * The keypair is persisted to apps/api/.dev-idp-key.json (gitignored) so restarts
 * don't invalidate tokens already handed out.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  type KeyLike,
} from "jose";

const PORT = Number(process.env.DEV_IDP_PORT ?? 9999);
const ISSUER = `http://localhost:${PORT}/`;
const AUDIENCE = process.env.DEV_IDP_AUDIENCE ?? "https://api.strengthinnumbers.app";
const NAMESPACE = process.env.DEV_IDP_NAMESPACE ?? "https://strengthinnumbers.app/";
const KID = "dev-idp-key-1";
const KEY_FILE = new URL("../.dev-idp-key.json", import.meta.url);

const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi"] as const;

function toPublicJwk(jwk: JWK): JWK {
  const pub = { ...jwk } as Record<string, unknown>;
  for (const m of PRIVATE_JWK_MEMBERS) delete pub[m];
  return pub as unknown as JWK;
}

async function loadOrCreateKey(): Promise<{ privateKey: KeyLike; publicJwk: JWK }> {
  if (existsSync(KEY_FILE)) {
    const privateJwk = JSON.parse(readFileSync(KEY_FILE, "utf8")) as JWK;
    const privateKey = (await importJWK(privateJwk, "RS256")) as KeyLike;
    return { privateKey, publicJwk: toPublicJwk(privateJwk) };
  }
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const privateJwk = await exportJWK(privateKey);
  privateJwk.kid = KID;
  privateJwk.alg = "RS256";
  privateJwk.use = "sig";
  writeFileSync(KEY_FILE, JSON.stringify(privateJwk, null, 2));
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { privateKey: privateKey as KeyLike, publicJwk };
}

interface MintOptions {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  noEmail?: boolean;
  expiresIn?: string;
}

async function mint(
  privateKey: KeyLike,
  opts: MintOptions = {},
): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (!opts.noEmail) {
    claims[`${NAMESPACE}email`] = opts.email ?? "dev@example.com";
    claims[`${NAMESPACE}email_verified`] = opts.emailVerified ?? true;
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(opts.sub ?? "devidp|user-1")
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "12h")
    .sign(privateKey);
}

const { privateKey, publicJwk } = await loadOrCreateKey();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
  };

  if (url.pathname === "/.well-known/jwks.json") {
    return json(200, { keys: [publicJwk] });
  }

  if (url.pathname === "/token") {
    const q = url.searchParams;
    void mint(privateKey, {
      sub: q.get("sub") ?? undefined,
      email: q.get("email") ?? undefined,
      emailVerified: q.get("email_verified") !== "false",
      noEmail: q.get("no_email") === "1",
      expiresIn: q.get("expires_in") ?? undefined,
    }).then((access_token) =>
      json(200, { access_token, token_type: "Bearer" }),
    );
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end(
    [
      "dev-idp — local Auth0 stand-in",
      "",
      `issuer:    ${ISSUER}`,
      `audience:  ${AUDIENCE}`,
      `namespace: ${NAMESPACE}`,
      "",
      "GET /.well-known/jwks.json",
      "GET /token?sub=&email=&email_verified=false&no_email=1&expires_in=1h",
    ].join("\n"),
  );
});

server.listen(PORT, () => {
  void (async () => {
    const userToken = await mint(privateKey, { sub: "devidp|carol" });
    const m2mToken = await mint(privateKey, { sub: "devidp|m2m", noEmail: true });

    process.stdout.write(
      [
        "",
        `  dev-idp listening on ${ISSUER}`,
        "",
        "  Point the API at it:",
        `    AUTH0_ISSUER=${ISSUER}`,
        `    AUTH0_AUDIENCE=${AUDIENCE}`,
        `    AUTH0_CLAIM_NAMESPACE=${NAMESPACE}`,
        "",
        "  Fresh user token (has email claims → provisions on /v1/me):",
        `    ${userToken}`,
        "",
        "  M2M-style token (no email claim → 200 on /_authcheck, 401 on /v1/me):",
        `    ${m2mToken}`,
        "",
        "  Grab more anytime:  curl -s localhost:" + PORT + "/token | jq -r .access_token",
        "",
      ].join("\n") + "\n",
    );
  })();
});
