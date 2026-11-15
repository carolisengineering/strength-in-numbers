import type { Secrets } from "./env.ts";

/**
 * Spec 16 AC22 — every secret value (and any `extra` value, such as tokens) in `text` becomes "[redacted]". The
 * longest values go first, so a value that contains another is replaced whole.
 */
export function redact(text: string, secrets: Secrets, extra: readonly string[] = []): string {
  return replaceAll(text, longestFirst([...secrets.values(), ...extra]));
}

function longestFirst(values: Iterable<string>): string[] {
  return [...values].filter((v) => v !== "").sort((a, b) => b.length - a.length);
}

/** `sorted` is longest first, so a value that contains another is replaced whole. */
function replaceAll(text: string, sorted: readonly string[]): string {
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
  /** Minor 594: sorted once per change, not on every `apply`; `null` after a new value is learned. */
  #sorted: string[] | null = null;

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
      this.#sorted = null;
    }
  }

  apply(text: string): string {
    this.#sorted ??= longestFirst(this.#values);
    return replaceAll(text, this.#sorted);
  }
}
