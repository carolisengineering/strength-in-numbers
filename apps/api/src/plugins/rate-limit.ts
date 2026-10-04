import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit, { type FastifyRateLimitStoreCtor } from "@fastify/rate-limit";
import { RateLimitedError, type RateLimitSource } from "../errors/app-error.js";

/**
 * Spec 05.2 — rate limiting: L1 per-IP, L2 per-user write groups, L3 per-user
 * in-flight write cap. See the spec §6 for why the plugin's own hooks are not
 * used (D11) and why L3 releases on `onSend` (D13).
 */

export type WriteGroup = "sets" | "workouts" | "exercises" | "me";
export const WRITE_GROUPS: readonly WriteGroup[] = ["sets", "workouts", "exercises", "me"];

declare module "fastify" {
  interface FastifyContextConfig {
    /** Spec 05.2 AC6 — infra routes no layer counts. */
    skipRateLimit?: boolean;
    /** Spec 05.2 §6.1 — required on every /v1 write route. */
    writeGroup?: WriteGroup;
  }
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly ip: number;
  readonly groups: Readonly<Record<WriteGroup, number>>;
  readonly inflight: number;
  /** Tests only (AC10): replaces the plugin's in-memory LRU store. */
  readonly store?: FastifyRateLimitStoreCtor;
}

/** Spec 05.2 §6.2 — the one place limits are written. */
export const RATE_LIMITS: RateLimitConfig = Object.freeze({
  windowMs: 60_000,
  ip: 600,
  groups: Object.freeze({ sets: 120, workouts: 60, exercises: 20, me: 10 }),
  inflight: 4,
});

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 shared / CGNAT space
];

/** RFC 1918 / RFC 6598 shared / loopback / link-local / ULA, including IPv4-mapped IPv6. */
export function isPrivateAddress(ip: string): boolean {
  const lower = ip.toLowerCase();
  const v4 = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  if (PRIVATE_V4.some((re) => re.test(v4))) return true;
  return lower === "::1" || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe80:/.test(lower);
}

/**
 * Spec 05.2 §6.6 / D12 — Fastify `trustProxy` function for Render. Render fronts
 * every service with Cloudflare: a request reaches us from a Render proxy on a
 * private socket with `X-Forwarded-For: <client>, <cloudflare-edge>`, and
 * Cloudflare appends to any header the client sent. Trust the socket only if it
 * is private (Render's proxy — a public peer is the client itself), then exactly
 * one more hop (the edge); anything further left is client-supplied. A function,
 * not the hop count `2`: Fastify ≥ 5.12 ignores numeric `trustProxy` because a
 * count can't check the immediate peer.
 */
export function trustRenderProxy(address: string, hop: number): boolean {
  return hop === 0 ? isPrivateAddress(address) : hop === 1;
}

/**
 * §6.6 — in production, a private `req.ip` means `trustProxy` no longer matches
 * the proxy chain (e.g. Spec 15's AWS move) and every user shares one L1 bucket.
 * The same holds when the request carried `X-Forwarded-For` but `req.ip` is still
 * the socket — the proxy's address wasn't trusted, whatever range it is in. Warn
 * once per process.
 */
export function trustProxyTripwire(): (request: FastifyRequest) => void {
  let warned = false;
  return (request) => {
    if (warned) return;
    if (isPrivateAddress(request.ip)) {
      warned = true;
      request.log.warn({ ip: request.ip }, "trust_proxy_suspect");
      return;
    }
    const forwarded = request.headers?.["x-forwarded-for"] !== undefined;
    if (forwarded && request.ip === request.socket?.remoteAddress) {
      warned = true;
      request.log.warn({ ip: request.ip, forwardedIgnored: true }, "trust_proxy_suspect");
    }
  };
}

type Limiter = ReturnType<FastifyInstance["createRateLimit"]>;

/** Run one limiter; throw on exceed; fail open (log, allow) if it throws (AC10, D8). */
async function enforce(limiter: Limiter, request: FastifyRequest, source: RateLimitSource): Promise<void> {
  let result: Awaited<ReturnType<Limiter>>;
  try {
    result = await limiter(request);
  } catch (err) {
    request.log.error({ err, layer: source.layer, group: source.group }, "rate_limiter_failed");
    return;
  }
  if (!result.isAllowed && result.isExceeded) throw new RateLimitedError(result.ttlInSeconds, source);
}

export interface WriteLimits {
  attachWriteLimits(v1: FastifyInstance): void;
}

/**
 * Registers the store and the L1 hook on the ROOT instance. Call it after
 * `@fastify/cors` registers (so preflights are answered first) and before the
 * `/v1` scope registers (a parent's app-level `onRequest` runs before the
 * child's auth hook — AC2).
 */
export async function registerRateLimits(
  app: FastifyInstance,
  config: RateLimitConfig,
  opts: { isProduction: boolean },
): Promise<WriteLimits> {
  // global: false → the plugin adds no hooks of its own; we only use its store
  // through createRateLimit (D11).
  await app.register(rateLimit, { global: false, ...(config.store ? { store: config.store } : {}) });

  const ipLimiter = app.createRateLimit({
    max: config.ip,
    timeWindow: config.windowMs,
    // The plugin's IPv6 normalisation: one /64 is one client.
    keyGenerator: (req) => rateLimit.normalizeIP(req.ip),
  });
  const tripwire = opts.isProduction ? trustProxyTripwire() : () => {};

  app.addHook("onRequest", async (request) => {
    // Skip first: Render's health checks come from a private address and must
    // not trip the trust-proxy tripwire.
    if (request.routeOptions.config?.skipRateLimit === true) return;
    tripwire(request);
    await enforce(ipLimiter, request, { layer: "ip" });
  });

  const groupLimiters = Object.fromEntries(
    WRITE_GROUPS.map((group) => [
      group,
      // Each createRateLimit call gets its own child store (AC4); every route in
      // the group calls this same limiter (AC3).
      app.createRateLimit({
        max: config.groups[group],
        timeWindow: config.windowMs,
        keyGenerator: (req) => req.user!.id,
      }),
    ]),
  ) as Record<WriteGroup, Limiter>;
  const inflight = new InflightCounter(config.inflight);

  return {
    attachWriteLimits(v1) {
      // Structural, like Spec 03.0's response-schema check: a /v1 write route
      // that names no group fails app assembly instead of shipping unlimited.
      v1.addHook("onRoute", (route) => {
        const methods = [route.method].flat();
        const group = route.config?.writeGroup;
        if (methods.every((m) => READ_METHODS.has(m))) {
          if (group !== undefined) {
            throw new Error(
              `Route ${methods.join(",")} ${route.url} is a read route but declares config.writeGroup (Spec 05.2 §6.1).`,
            );
          }
          return;
        }
        if (group === undefined) {
          throw new Error(
            `Route ${methods.join(",")} ${route.url} is a write route with no config.writeGroup. ` +
              "Every /v1 write route must name its rate-limit group (Spec 05.2 §6.1, §6.2).",
          );
        }
        const limiter = groupLimiters[group];
        // preValidation: after the auth onRequest hook (request.user is set) but
        // before body validation, so a malformed-body flood still counts.
        const l2 = async (request: FastifyRequest) => enforce(limiter, request, { layer: "user-rate", group });
        const existing = route.preValidation === undefined ? [] : [route.preValidation].flat();
        route.preValidation = [...existing, l2] as typeof route.preValidation;
        // L3 in preHandler: only a request that passed L2 and validation, i.e.
        // one about to do real work, holds a slot.
        const l3 = async (request: FastifyRequest) => inflight.acquire(request);
        const existingPre = route.preHandler === undefined ? [] : [route.preHandler].flat();
        route.preHandler = [...existingPre, l3] as typeof route.preHandler;
      });
      v1.addHook("onSend", async (request, _reply, payload) => {
        inflight.release(request);
        return payload;
      });
      // Backstop; a no-op once onSend released (per-request WeakMap).
      v1.addHook("onResponse", async (request) => {
        inflight.release(request);
      });
    },
  };
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Spec 05.2 §6.5 — per-user writes in flight. Released on `onSend` (D13): after a
 * mid-handler client abort, Fastify 5 fires `onSend` when the handler finishes but
 * neither `onResponse` nor `onRequestAbort`, and releasing on the raw `close`
 * would free the slot while the handler still holds a pooled connection.
 */
export class InflightCounter {
  private readonly counts = new Map<string, number>();
  private readonly held = new WeakMap<FastifyRequest, string>();

  constructor(private readonly max: number) {}

  acquire(request: FastifyRequest): void {
    const id = request.user!.id;
    const n = this.counts.get(id) ?? 0;
    if (n >= this.max) throw new RateLimitedError(1, { layer: "user-inflight" });
    this.counts.set(id, n + 1);
    this.held.set(request, id);
  }

  release(request: FastifyRequest): void {
    const id = this.held.get(request);
    if (id === undefined) return;
    this.held.delete(request);
    const n = (this.counts.get(id) ?? 0) - 1;
    if (n < 0) request.log.warn({ userId: id }, "inflight_underflow");
    if (n <= 0) this.counts.delete(id);
    else this.counts.set(id, n);
  }

  get size(): number {
    return this.counts.size;
  }
}
