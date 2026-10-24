/**
 * Spec 15 AC5 / AC24 — read `infra/prod.tfvars`, the one committed source of production identifiers (pure).
 */
/** `key = "value"` lines (string values only; comments ignored). */
export function parseTfvars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s*=\s*"([^"]*)"/i.exec(line);
    if (m) vars[m[1]!] = m[2]!;
  }
  return vars;
}

/** The deterministic Cloud Run origin and the Firebase Hosting origin those identifiers produce. */
export function prodOrigins(tfvarsText: string): { apiOrigin: string; webOrigin: string } {
  const v = parseTfvars(tfvarsText);
  return {
    apiOrigin: `https://${v.service_name}-${v.project_number}.${v.region}.run.app`,
    webOrigin: `https://${v.hosting_site_id}.web.app`,
  };
}

/** The keys still holding a `REPLACE_ME` placeholder (strict go-live mode refuses any). */
export function placeholderIds(tfvarsText: string): string[] {
  return Object.entries(parseTfvars(tfvarsText))
    .filter(([, value]) => value.startsWith("REPLACE_ME"))
    .map(([key]) => key);
}
