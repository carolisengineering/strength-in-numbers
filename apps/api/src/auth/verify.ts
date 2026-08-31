import {
  jwtVerify,
  createRemoteJWKSet,
  errors as joseErrors,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import {
  AuthUnavailableError,
  InvalidTokenError,
  UnauthenticatedError,
} from "../errors/app-error.js";

/**
 * Access-token verification (Spec 01 §6.1).
 *
 * RS256 only. Pins `iss` + `aud`, bounded 60 s clock skew. The critical
 * distinction: a token whose signing key is genuinely absent from a *reachable*
 * JWKS is `invalid-token` (401); an inability to *obtain* the JWKS (timeout,
 * DNS, TLS, non-2xx) is `auth-unavailable` (503) — the token may be fine and the
 * client should retry, not re-authenticate.
 */

export interface AuthContext {
  readonly authSub: string;
  readonly email: string | undefined;
  readonly emailVerified: boolean | undefined;
  readonly claims: JWTPayload;
}

export interface TokenVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly claimNamespace: string;
  /** Production: the JWKS endpoint. Omit when supplying `keyResolver`. */
  readonly jwksUri?: string;
  /** Test seam: a key resolver in place of a remote JWKS URI. */
  readonly keyResolver?: JWTVerifyGetKey;
  readonly timeoutMs?: number;
  readonly cooldownMs?: number;
  readonly cacheMaxAgeMs?: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthContext>;
}

const CLOCK_TOLERANCE_S = 60;
const DEFAULTS = {
  timeoutMs: 5_000,
  cooldownMs: 30_000,
  cacheMaxAgeMs: 600_000,
} as const;

export function parseAuthorizationHeader(header: string | undefined): string {
  if (!header) {
    throw new UnauthenticatedError("no Authorization header");
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    throw new UnauthenticatedError("Authorization header is not a Bearer token");
  }
  return token;
}

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  let resolver: JWTVerifyGetKey;
  if (opts.keyResolver) {
    resolver = opts.keyResolver;
  } else {
    if (!opts.jwksUri) {
      throw new Error("createTokenVerifier: jwksUri or keyResolver is required");
    }
    resolver = createRemoteJWKSet(new URL(opts.jwksUri), {
      timeoutDuration: opts.timeoutMs ?? DEFAULTS.timeoutMs,
      cooldownDuration: opts.cooldownMs ?? DEFAULTS.cooldownMs,
      cacheMaxAge: opts.cacheMaxAgeMs ?? DEFAULTS.cacheMaxAgeMs,
    });
  }

  const emailKey = `${opts.claimNamespace}email`;
  const emailVerifiedKey = `${opts.claimNamespace}email_verified`;

  return {
    async verify(token: string): Promise<AuthContext> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, resolver, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ["RS256"],
          clockTolerance: CLOCK_TOLERANCE_S,
        }));
      } catch (err) {
        throw mapJoseError(err);
      }

      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new InvalidTokenError("token has no usable sub claim");
      }

      const emailRaw = payload[emailKey];
      const emailVerifiedRaw = payload[emailVerifiedKey];

      return {
        authSub: payload.sub,
        email: typeof emailRaw === "string" ? emailRaw : undefined,
        emailVerified:
          typeof emailVerifiedRaw === "boolean" ? emailVerifiedRaw : undefined,
        claims: payload,
      };
    },
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function mapJoseError(err: unknown): AppErrorLike {
  // Key genuinely not present in a JWKS we *did* fetch → bad token.
  if (err instanceof joseErrors.JWKSNoMatchingKey) {
    return new InvalidTokenError("no JWKS key matches the token kid");
  }
  // Could not obtain / trust the key set → upstream problem, retryable.
  if (
    err instanceof joseErrors.JWKSTimeout ||
    err instanceof joseErrors.JWKSInvalid
  ) {
    return new AuthUnavailableError(`JWKS unavailable — ${describe(err)}`, {
      cause: err,
    });
  }
  // Any other JOSE error — signature / claim / expiry / alg failure, or a token
  // that can't be unambiguously matched to a key (`JWKSMultipleMatchingKeys`,
  // e.g. no `kid` during rotation) — is a bad token, not an outage.
  if (err instanceof joseErrors.JOSEError) {
    return new InvalidTokenError(`${err.code}: ${err.message}`);
  }
  // A non-JOSE throw (fetch TypeError, ECONNREFUSED, DNS, abort) escaping the
  // remote-JWKS fetch means the key set was unreachable.
  return new AuthUnavailableError(`JWKS fetch failed — ${describe(err)}`, {
    cause: err,
  });
}

// Local alias so mapJoseError's return type stays readable without importing the
// abstract base just for the annotation.
type AppErrorLike = InvalidTokenError | AuthUnavailableError;
