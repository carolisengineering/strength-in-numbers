import { describe, it, expect, beforeAll } from "vitest";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  errors as joseErrors,
  type JWK,
  type KeyLike,
  type JWTVerifyGetKey,
} from "jose";
import {
  createTokenVerifier,
  parseAuthorizationHeader,
} from "../../src/auth/verify.js";
import {
  AuthUnavailableError,
  InvalidTokenError,
  UnauthenticatedError,
} from "../../src/errors/app-error.js";

const ISSUER = "https://si-staging.us.auth0.com/";
const AUDIENCE = "https://api.strengthinnumbers.app";
const NS = "https://strengthinnumbers.app/";
const KID = "test-key-1";

let privateKey: KeyLike;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwks = { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] };
});

const nowS = () => Math.floor(Date.now() / 1000);

interface MintOpts {
  sub?: string | null;
  aud?: string;
  iss?: string;
  kid?: string;
  exp?: number;
  nbf?: number;
  claims?: Record<string, unknown>;
  signWith?: KeyLike;
}

async function mint(opts: MintOpts = {}): Promise<string> {
  const jwt = new SignJWT({ ...(opts.claims ?? {}) })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? nowS() + 300);
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "auth0|user-123");
  if (opts.nbf !== undefined) jwt.setNotBefore(opts.nbf);
  return jwt.sign(opts.signWith ?? privateKey);
}

const verifier = (keyResolver: JWTVerifyGetKey) =>
  createTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    claimNamespace: NS,
    keyResolver,
  });

const good = () => verifier(createLocalJWKSet(jwks));

describe("parseAuthorizationHeader (Criterion 5)", () => {
  it("returns the token for a well-formed header", () => {
    expect(parseAuthorizationHeader("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(parseAuthorizationHeader("bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it.each([undefined, "", "abc.def.ghi", "Bearer", "Bearer    ", "Token abc"])(
    "throws UnauthenticatedError for %p",
    (header) => {
      expect(() =>
        parseAuthorizationHeader(header as string | undefined),
      ).toThrow(UnauthenticatedError);
    },
  );
});

describe("verify — valid token (Criterion 6)", () => {
  it("returns authSub and namespaced email claims", async () => {
    const token = await mint({
      sub: "auth0|abc",
      claims: { [`${NS}email`]: "a@b.com", [`${NS}email_verified`]: true },
    });
    const ctx = await good().verify(token);
    expect(ctx.authSub).toBe("auth0|abc");
    expect(ctx.email).toBe("a@b.com");
    expect(ctx.emailVerified).toBe(true);
    expect(ctx.claims.iss).toBe(ISSUER);
  });

  it("leaves email undefined for an M2M token with no email claim", async () => {
    const ctx = await good().verify(await mint({ sub: "clients|m2m" }));
    expect(ctx.authSub).toBe("clients|m2m");
    expect(ctx.email).toBeUndefined();
    expect(ctx.emailVerified).toBeUndefined();
  });

  it("email present without email_verified → emailVerified undefined", async () => {
    const ctx = await good().verify(
      await mint({ claims: { [`${NS}email`]: "a@b.com" } }),
    );
    expect(ctx.email).toBe("a@b.com");
    expect(ctx.emailVerified).toBeUndefined();
  });
});

describe("verify — bad tokens → 401 invalid-token (Criterion 6)", () => {
  it("expired", async () => {
    await expect(
      good().verify(await mint({ exp: nowS() - 3600 })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("not yet valid (nbf in the future)", async () => {
    await expect(
      good().verify(await mint({ nbf: nowS() + 7200 })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("wrong audience", async () => {
    await expect(
      good().verify(await mint({ aud: "https://evil.example.com" })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("wrong issuer", async () => {
    await expect(
      good().verify(await mint({ iss: "https://evil.auth0.com/" })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("bad signature (signed by a foreign key)", async () => {
    const foreign = await generateKeyPair("RS256");
    const token = await mint({ signWith: foreign.privateKey });
    await expect(good().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("unknown kid with a reachable JWKS → invalid-token, NOT auth-unavailable", async () => {
    const token = await mint({ kid: "not-in-the-set" });
    await expect(good().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("alg: none is rejected", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        sub: "auth0|x",
        iss: ISSUER,
        aud: AUDIENCE,
        exp: nowS() + 300,
      }),
    ).toString("base64url");
    await expect(good().verify(`${header}.${body}.`)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("garbage string", async () => {
    await expect(good().verify("not-a-jwt")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("token with no sub claim", async () => {
    await expect(
      good().verify(await mint({ sub: null })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe("verify — JWKS unavailable → 503 auth-unavailable (Criterion 16)", () => {
  it("maps a jose JWKSTimeout to AuthUnavailableError", async () => {
    const resolver: JWTVerifyGetKey = (() => {
      throw new joseErrors.JWKSTimeout();
    }) as unknown as JWTVerifyGetKey;
    await expect(
      verifier(resolver).verify(await mint()),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("maps a network fetch failure to AuthUnavailableError", async () => {
    const resolver: JWTVerifyGetKey = (() => {
      throw new TypeError("fetch failed");
    }) as unknown as JWTVerifyGetKey;
    await expect(
      verifier(resolver).verify(await mint()),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("maps JWKSMultipleMatchingKeys to InvalidTokenError, NOT auth-unavailable", async () => {
    const resolver: JWTVerifyGetKey = (() => {
      throw new joseErrors.JWKSMultipleMatchingKeys();
    }) as unknown as JWTVerifyGetKey;
    await expect(
      verifier(resolver).verify(await mint()),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("does not leak the internal reason in publicDetail", async () => {
    const resolver: JWTVerifyGetKey = (() => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.5:443");
    }) as unknown as JWTVerifyGetKey;
    await expect(verifier(resolver).verify(await mint())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof AuthUnavailableError &&
        !/ECONNREFUSED/.test(e.publicDetail),
    );
  });

  it("handles a non-Error throw from the resolver", async () => {
    const resolver: JWTVerifyGetKey = (() => {
      throw "socket hang up";
    }) as unknown as JWTVerifyGetKey;
    await expect(
      verifier(resolver).verify(await mint()),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
  });
});

describe("createTokenVerifier — construction", () => {
  it("throws when neither jwksUri nor keyResolver is supplied", () => {
    expect(() =>
      createTokenVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        claimNamespace: NS,
      }),
    ).toThrow(/jwksUri or keyResolver/);
  });

  it("builds a remote-JWKS verifier from a jwksUri without throwing", () => {
    const v = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      claimNamespace: NS,
      jwksUri: `${ISSUER}.well-known/jwks.json`,
    });
    expect(typeof v.verify).toBe("function");
  });
});
