import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stylesheets } from "../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Every CSS module in the app, comments already stripped. */
const modules = stylesheets(SRC).filter((sheet) => sheet.path.endsWith(".module.css"));

/** Each `selector { body }` block of a stylesheet (no nesting in these modules). */
function blocks(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1]!.trim(), body: match[2]! }));
}

describe("Minor 233 — every label and legend uses the label weight token", () => {
  it("no label or legend rule writes font-weight: 600 by hand", () => {
    expect(modules.length).toBeGreaterThan(50);
    const hits = modules.flatMap(({ path, css }) =>
      blocks(css)
        .filter((b) => /\b(label|legend)\b/.test(b.selector) && /font-weight:\s*600\b/.test(b.body))
        .map((b) => `${relative(SRC, path)} ${b.selector}`),
    );
    expect(hits).toEqual([]);
  });
});
