/**
 * Server-side encoding of the catalog sync token (Spec 03.3 §5, D33). Lives in
 * apps/api, not @sin/core: the token is opaque to clients, and @sin/core ships to
 * the web bundle. The `1.` prefix is a format version reserved for a future
 * restore-epoch (D27).
 */
const PREFIX = "1.";

export const formatSyncToken = (xid: string): string => `${PREFIX}${xid}`;

/** Strips the version prefix from a token already validated by `CatalogSinceQuery`. */
export function parseSyncToken(token: string): string {
  if (!token.startsWith(PREFIX)) {
    throw new Error(
      "parseSyncToken: not a version-1 sync token (validate with isSyncToken first)",
    );
  }
  return token.slice(PREFIX.length);
}
