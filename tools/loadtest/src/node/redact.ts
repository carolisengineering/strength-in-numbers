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

  /**
   * Minor 593: also the value's JSON-escaped form, because the result file is redacted after `JSON.stringify`, which
   * escapes a quote, a backslash or a newline inside a secret.
   */
  learnValues(values: Iterable<string>): void {
    for (const v of values) {
      if (v === "") continue;
      this.#values.add(v);
      const escaped = JSON.stringify(v).slice(1, -1);
      if (escaped !== v) this.#values.add(escaped);
    }
  }

  apply(text: string): string {
    return replaceAll(text, this.#values);
  }
}
