import { BlockList, isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit, { type FastifyRateLimitStoreCtor } from "@fastify/rate-limit";
import { RateLimitedError, type RateLimitSource } from "../errors/app-error.js";

/**
 * Spec 05.2 — rate limiting: L1 per-IP, L2 per-user write groups, L3 per-user
 * in-flight write cap. See the spec §6 for why the plugin's own hooks are not
 * used (D11) and why L3 releases on `onSend` (D13).
 */

/** Spec 19.0 D15 adds `hevy` (the owner-only Hevy routes). */
export type WriteGroup = "sets" | "workouts" | "exercises" | "routines" | "me" | "hevy";
export const WRITE_GROUPS: readonly WriteGroup[] = ["sets", "workouts", "exercises", "routines", "me", "hevy"];

declare module "fastify" {
  interface FastifyContextConfig {
    /** Spec 05.2 AC6 — liveness / readiness probes only: no layer counts them. */
    skipRateLimit?: boolean;
    /** Spec 05.2 AC17 (#12) — also charge this route to a tighter per-IP budget,
     * after L1. `"docs"`: the ~250 KB `/openapi.json`, an egress amplifier. */
    ipBudget?: "docs";
    /** Spec 05.2 §6.1 — required on every /v1 write route. */
    writeGroup?: WriteGroup;
    /** Spec 11 D8 — also charge this read route to a per-user budget, after
     * auth. `"export"`: `GET /v1/account/export`, the heaviest read. */
    userBudget?: "export";
  }
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly ip: number;
  /** AC17 — per IP, for routes with `config.ipBudget: "docs"`. */
  readonly docs: number;
  /** Spec 11 D8 — per user, for routes with config.userBudget: "export". */
  readonly exportPerUser: number;
  readonly groups: Readonly<Record<WriteGroup, number>>;
  readonly inflight: number;
  /** Tests only (AC10): replaces the plugin's in-memory LRU store. */
  readonly store?: FastifyRateLimitStoreCtor;
}

/** Spec 05.2 §6.2 — the one place limits are written. */
export const RATE_LIMITS: RateLimitConfig = Object.freeze({
  windowMs: 60_000,
  ip: 600,
  // ~250 KB per response: 30/min caps one IP at ~7.5 MB/min (L1 alone allows ~150).
  docs: 30,
  // Spec 11 D8: a retry or two after a failed download; caps a few MB/min/user.
  exportPerUser: 3,
  groups: Object.freeze({ sets: 120, workouts: 60, exercises: 20, routines: 30, me: 10, hevy: 60 }),
  inflight: 4,
});

// RFC 1918, RFC 6598 shared / CGNAT, loopback, link-local.
const PRIVATE_V4: readonly [string, number][] = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
];
const PRIVATE = new BlockList();
for (const [network, prefix] of PRIVATE_V4) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
  // The same range as IPv4-mapped IPv6 (::ffff:a.b.c.d), in any spelling.
  PRIVATE.addSubnet(`::ffff:${network}`, 96 + prefix, "ipv6");
}
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6"); // unique local
PRIVATE.addSubnet("fe80::", 10, "ipv6"); // link-local

/** RFC 1918 / RFC 6598 shared / loopback / link-local / ULA, including IPv4-mapped IPv6. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

function socketAddress(request: FastifyRequest): string {
  return request.socket?.remoteAddress ?? request.ip;
}

function cfConnectingIp(request: FastifyRequest): string | null {
  const raw = request.headers?.["cf-connecting-ip"];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return isIP(value) === 0 ? null : value;
}

/** Spec 15 AC25: which proxy chain sits in front of the API. */
export type ClientIpSource = "render" | "cloud-run";

/**
 * Spec 15 §6.2: on Cloud Run the Google front end appends the address that connected to it to
 * `X-Forwarded-For`, so the entry this many places from the right is the client; everything to its left
 * is client-controlled. 1 is an assumption until the go-live measurement (AC28, runbook D4.d) confirms it.
 */
export const CLOUD_RUN_XFF_HOPS = 1;

/** The `X-Forwarded-For` entry the Cloud Run front end added, or null if it is absent or not an IP. */
function cloudRunForwardedFor(request: FastifyRequest): string | null {
  const raw = request.headers?.["x-forwarded-for"];
  if (typeof raw !== "string") return null;
  const entries = raw.split(",").map((e) => e.trim());
  const value = entries[entries.length - CLOUD_RUN_XFF_HOPS];
  return value !== undefined && isIP(value) !== 0 ? value : null;
}

/** Spec 15 §6.2 / AC26: a public socket is the client; behind a private one, the front end's XFF entry. */
function cloudRunClientAddress(request: FastifyRequest): string {
  const socket = socketAddress(request);
  if (!isPrivateAddress(socket)) return socket;
  return cloudRunForwardedFor(request) ?? socket;
}

/**
 * Spec 05.2 §6.6 / D12 — the client address the L1 limit keys on (and every request's `client_ip`).
 *
 * `render` (the default): Cloudflare
 * sets `CF-Connecting-IP` on every proxied request to the address that
 * connected to it, overwriting anything the client sent, so it is used — but
 * only behind a **private / loopback socket** (Render's own infrastructure),
 * which no end user can connect from. Any public socket is itself the client,
 * Cloudflare-owned ones included: WARP and Workers egress from Cloudflare
 * ranges, so trusting those would let such a client choose its key (code
 * reviews, 2026-10-04). `X-Forwarded-For` is never read in this mode.
 *
 * `cloud-run` (Spec 15 §6.2, AC26): the socket when it is public, else the `X-Forwarded-For` entry the Google
 * front end appended (`CLOUD_RUN_XFF_HOPS` from the right), else the socket. `CF-Connecting-IP` is never read.
 */
export function clientAddress(request: FastifyRequest, source: ClientIpSource = "render"): string {
  if (source === "cloud-run") return cloudRunClientAddress(request);
  const socket = socketAddress(request);
  if (!isPrivateAddress(socket)) return socket;
  return cfConnectingIp(request) ?? socket;
}

/**
 * §6.6 — warn once per process when the Cloudflare assumption breaks for a
 * forwarded request: it came through a private proxy but has no usable
 * `CF-Connecting-IP` (`no-cf-connecting-ip`), or it came from a public socket
 * (`unknown-proxy` — e.g. Render handing us the Cloudflare edge directly, or a
 * new load balancer; the logged `socket` says which). Either way every user
 * behind that proxy shares one L1 bucket. Requests with no `X-Forwarded-For`
 * (internal probes, health checks, direct clients) never count, so they can't
 * spend the single warning.
 */
export function trustProxyTripwire(source: ClientIpSource = "render"): (request: FastifyRequest) => void {
  let warned = false;
  return (request) => {
    if (warned || request.headers?.["x-forwarded-for"] === undefined) return;
    const socket = socketAddress(request);
    // Spec 15 AC27: on Cloud Run a forwarded request must carry a usable front-end entry.
    const forwarded = source === "cloud-run" ? cloudRunForwardedFor(request) : cfConnectingIp(request);
    const reason = isPrivateAddress(socket)
      ? forwarded === null
        ? source === "cloud-run"
          ? "no-xff"
          : "no-cf-connecting-ip"
        : null
      : "unknown-proxy";
    if (reason === null) return;
    warned = true;
    request.log.warn({ socket, reason }, "trust_proxy_suspect");
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
  opts: { isProduction: boolean; clientIpSource?: ClientIpSource },
): Promise<WriteLimits> {
  const source = opts.clientIpSource ?? "render";
  // global: false → the plugin adds no hooks of its own; we only use its store
  // through createRateLimit (D11).
  await app.register(rateLimit, { global: false, ...(config.store ? { store: config.store } : {}) });

  // The client behind Cloudflare (§6.6), normalised so one IPv6 /64 is one client.
  const ipKey = (req: FastifyRequest) => rateLimit.normalizeIP(clientAddress(req, source));
  const ipLimiter = app.createRateLimit({ max: config.ip, timeWindow: config.windowMs, keyGenerator: ipKey });
  // AC17: its own child store, so docs requests and L1 never share a counter.
  const docsLimiter = app.createRateLimit({ max: config.docs, timeWindow: config.windowMs, keyGenerator: ipKey });
  const tripwire = opts.isProduction ? trustProxyTripwire(source) : () => {};

  app.addHook("onRequest", async (request) => {
    // Every later log line of this request (incl. "request completed") carries
    // the resolved client — the runbook D4.d check reads it.
    (request.log as { setBindings?: (b: Record<string, unknown>) => void }).setBindings?.({
      client_ip: clientAddress(request, source),
    });
    if (request.routeOptions.config?.skipRateLimit === true) return;
    tripwire(request);
    await enforce(ipLimiter, request, { layer: "ip" });
    if (request.routeOptions.config?.ipBudget === "docs") {
      await enforce(docsLimiter, request, { layer: "ip-docs" });
    }
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
  // Spec 11 D8: per user, keyed like the write groups. No user (impossible on
  // /v1 after auth) → keyGenerator throws → enforce fails open (AC10, 05.2 D8).
  const exportLimiter = app.createRateLimit({
    max: config.exportPerUser,
    timeWindow: config.windowMs,
    keyGenerator: (req) => req.user!.id,
  });
  const inflight = new InflightCounter(config.inflight);

  return {
    attachWriteLimits(v1) {
      // Structural, like Spec 03.0's response-schema check: a /v1 write route
      // that names no group fails app assembly instead of shipping unlimited.
      v1.addHook("onRoute", (route) => {
        if (route.config?.userBudget === "export") {
          // preParsing: after the auth onRequest hook, before any handler work.
          const budget = async (request: FastifyRequest, _reply: unknown, payload: unknown) => {
            await enforce(exportLimiter, request, { layer: "user-export" });
            return payload;
          };
          const existingBudget = route.preParsing === undefined ? [] : [route.preParsing].flat();
          route.preParsing = [...existingBudget, budget] as typeof route.preParsing;
        }
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
        // preParsing: after the auth onRequest hook (request.user is set) but
        // before the body is read or validated, so a write that fails to parse
        // (bad JSON, wrong media type, too large) or to validate still counts (D14).
        const l2 = async (request: FastifyRequest, _reply: unknown, payload: unknown) => {
          await enforce(limiter, request, { layer: "user-rate", group });
          return payload;
        };
        const existing = route.preParsing === undefined ? [] : [route.preParsing].flat();
        route.preParsing = [...existing, l2] as typeof route.preParsing;
        // L3 in preHandler: only a request that passed L2 and validation, i.e.
        // one about to do real work, holds a slot.
        const l3 = async (request: FastifyRequest) => inflight.acquire(request);
        const existingPre = route.preHandler === undefined ? [] : [route.preHandler].flat();
        route.preHandler = [...existingPre, l3] as typeof route.preHandler;
        // Release on this route only (reads never hold a slot). onResponse is a
        // backstop; a no-op once onSend released (per-request WeakMap).
        const release = async (request: FastifyRequest, _reply: unknown, payload: unknown) => {
          inflight.release(request);
          return payload;
        };
        const backstop = async (request: FastifyRequest) => {
          inflight.release(request);
        };
        const existingSend = route.onSend === undefined ? [] : [route.onSend].flat();
        route.onSend = [...existingSend, release] as typeof route.onSend;
        const existingResponse = route.onResponse === undefined ? [] : [route.onResponse].flat();
        route.onResponse = [...existingResponse, backstop] as typeof route.onResponse;
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
    const id = request.user?.id;
    // No user to key on: fail open like the other layers (AC10, D8).
    if (id === undefined) return;
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
