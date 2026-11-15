import type { Secrets } from "./env.ts";

/**
 * Spec 16 AC22 — every secret value (and any `extra` value, such as tokens) in `text` becomes "[redacted]". The
 * longest values go first, so a value that contains another is replaced whole.
 */
export function redact(text: string, secrets: Secrets, extra: readonly string[] = []): string {
  return replaceAll(text, [...secrets.values(), ...extra]);
}

function replaceAll(text: string, values: Iterable<string>): string {
  const sorted = [...values].filter((v) => v !== "").sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of sorted) out = out.split(value).join("[redacted]");
  return out;
}

/**
 * The CLI's one filter for everything it prints, its error output and the result file. It learns each secret and
 * token as the CLI loads them, so a message that ever quoted one (a library's error, say) still can't show it.
 */
export class Redactor {
  readonly #values = new Set<string>();

  learn(secrets: Secrets): void {
    this.learnValues(secrets.values());
  }

  learnValues(values: Iterable<string>): void {
    for (const v of values) if (v !== "") this.#values.add(v);
  }

  apply(text: string): string {
    return replaceAll(text, this.#values);
  }
}
