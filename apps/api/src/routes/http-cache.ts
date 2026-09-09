import { createHash } from "node:crypto";

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

/** True when an `If-None-Match` header carries a token equal to `etag`. */
export function ifNoneMatchHits(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw.split(",").some((token) => token.trim() === etag);
}
