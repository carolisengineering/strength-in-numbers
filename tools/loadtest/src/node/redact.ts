import type { Secrets } from "./env.ts";

/**
 * Spec 16 AC22 — every secret value (and any `extra` value, such as tokens) in `text` becomes "[redacted]". The
 * longest values go first, so a value that contains another is replaced whole.
 */
export function redact(text: string, secrets: Secrets, extra: readonly string[] = []): string {
  const values = [...secrets.values(), ...extra].filter((v) => v !== "").sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of values) out = out.split(value).join("[redacted]");
  return out;
}
