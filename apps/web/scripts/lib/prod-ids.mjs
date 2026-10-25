/**
 * Spec 15 AC5 / AC24 — read `infra/prod.tfvars`, the one committed source of production identifiers (pure).
 * The one place the production origins are derived: the API's `check-prod-ids.ts` and origins test and the
 * web's `assert-firebase-json.mjs` all import it (#167), so a change here (a custom domain) moves them together.
 * Plain .mjs so the web script runs on bare Node; `prod-ids.d.mts` types it for the API's TypeScript.
 */

/** `key = "value"` lines (string values only; comments ignored). */
export function parseTfvars(text) {
  const vars = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s*=\s*"([^"]*)"/i.exec(line);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

/** The deterministic Cloud Run origin and the Firebase Hosting origin those identifiers produce. */
export function prodOrigins(tfvarsText) {
  const v = parseTfvars(tfvarsText);
  return {
    apiOrigin: `https://${v.service_name}-${v.project_number}.${v.region}.run.app`,
    webOrigin: `https://${v.hosting_site_id}.web.app`,
  };
}

/** The keys still holding a `REPLACE_ME` placeholder (strict go-live mode refuses any). */
export function placeholderIds(tfvarsText) {
  return Object.entries(parseTfvars(tfvarsText))
    .filter(([, value]) => value.startsWith("REPLACE_ME"))
    .map(([key]) => key);
}
