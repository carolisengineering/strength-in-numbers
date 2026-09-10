import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";

/**
 * Conditional-request helpers shared by the catalog (`exercises.ts`) and
 * reference (`reference.ts`) read routes (Spec 03.1 §6.1–6.2).
 */

/**
 * A strong `ETag`: `"` + the first 32 hex of `sha256(parts joined by "\n")` +
 * `"`. The first part is a namespace sentinel (the delta cursor for
 * `/v1/exercises`, the payload key for a reference endpoint) so two responses
 * that happen to serialize to the same bytes on different routes — or a delta
 * that serializes like an earlier full pull — never share a validator and
 * cannot produce a spurious `304`.
 */
export function strongEtag(...parts: string[]): string {
  const hash = createHash("sha256");
  parts.forEach((part, i) => {
    if (i > 0) hash.update("\n", "utf8");
    hash.update(part, "utf8");
  });
  return `"${hash.digest("hex").slice(0, 32)}"`;
}

/**
 * True when an `If-None-Match` header matches `etag` under RFC 9110 §13.1.2
 * rules: `*` matches any current representation, and comparison is **weak** —
 * a `W/` prefix on either side is ignored. That matters in practice: a
 * compressing proxy (Render's edge, a CDN) downgrades our strong `"abc"` to
 * `W/"abc"` on the way out, and the browser echoes the weak form back. A
 * byte-for-byte compare would never `304` behind such a proxy.
 */
export function ifNoneMatchHits(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  const opaque = stripWeak(etag);
  return raw.split(",").some((token) => {
    const t = token.trim();
    return t === "*" || stripWeak(t) === opaque;
  });
}

const stripWeak = (tag: string): string =>
  tag.startsWith("W/") ? tag.slice(2) : tag;

/**
 * Append `value` to the response `Vary` header without clobbering what is
 * already there. `@fastify/cors` sets `Vary: Origin` in an `onRequest` hook
 * that runs before the handler, and `reply.header("vary", …)` would *replace*
 * it — silently dropping `Origin` from every CORS response. Idempotent and
 * case-insensitive, so calling it twice yields one token.
 */
export function addVary(reply: FastifyReply, value: string): void {
  const existing = reply.getHeader("vary");
  const current = Array.isArray(existing)
    ? existing.join(",")
    : existing === undefined
      ? ""
      : String(existing);
  const tokens = current
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.some((t) => t.toLowerCase() === value.toLowerCase())) {
    tokens.push(value);
  }
  reply.header("vary", tokens.join(", "));
}
