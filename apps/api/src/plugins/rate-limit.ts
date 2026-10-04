import type { FastifyRequest } from "fastify";

/**
 * Spec 05.2 — rate limiting: L1 per-IP, L2 per-user write groups, L3 per-user
 * in-flight write cap. See the spec §6 for why the plugin's own hooks are not
 * used (D11) and why L3 releases on `onSend` (D13).
 */

const PRIVATE_V4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];

/** RFC 1918 / loopback / link-local / ULA, including IPv4-mapped IPv6. */
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
 * Warn once per process.
 */
export function trustProxyTripwire(): (request: FastifyRequest) => void {
  let warned = false;
  return (request) => {
    if (warned || !isPrivateAddress(request.ip)) return;
    warned = true;
    request.log.warn({ ip: request.ip }, "trust_proxy_suspect");
  };
}
