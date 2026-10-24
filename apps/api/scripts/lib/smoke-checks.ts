/** Spec 15 AC20 — the API smoke's new checks (pure). Each returns null when ok, else the failure message. */

/** The `/healthz` body must report the deployed commit (no expectation → nothing to check). */
export function checkCommit(body: unknown, expect: string | undefined): string | null {
  if (!expect) return null;
  const commit = typeof body === "object" && body !== null ? (body as { commit?: unknown }).commit : undefined;
  if (typeof commit !== "string") return `/healthz has no commit (expected ${expect})`;
  return commit === expect ? null : `/healthz reports commit ${commit}, expected ${expect}`;
}

/** The preflight must allow exactly the web origin (never `*`) and the GET method. */
export function checkCorsPreflight(headers: Headers, configured: string): string | null {
  // A configured origin may carry a trailing slash; an Origin header never does.
  const origin = configured.replace(/\/+$/, "");
  const allowed = headers.get("access-control-allow-origin");
  if (allowed !== origin) return `CORS preflight allows origin ${allowed ?? "(none)"}, expected exactly ${origin}`;
  const methods = (headers.get("access-control-allow-methods") ?? "").split(",").map((m) => m.trim().toUpperCase());
  return methods.includes("GET") ? null : `CORS preflight methods ${methods.join(",") || "(none)"} do not include GET`;
}
