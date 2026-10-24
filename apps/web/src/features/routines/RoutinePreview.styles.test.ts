import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const rule = (path: string, selector: string): Record<string, string> => {
  const css = readFileSync(join(here, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const body = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  return Object.fromEntries(
    body
      .split(";")
      .map((d) => d.split(":").map((s) => s.trim()))
      .filter((d) => d.length === 2 && d[0] !== "")
      .map(([k, v]) => [k!, v!]),
  );
};

describe("deferred minor 43 — the preview's secondary links look like the secondary Button beside them", () => {
  it("fill, text, border, size and weight match `Button` variant secondary", () => {
    const button = { ...rule("../../ui/Button.module.css", ".button"), ...rule("../../ui/Button.module.css", ".secondary") };
    const link = rule("./RoutinePreview.module.css", ".secondary");
    for (const property of ["background", "color", "font-size", "font-weight"]) expect(link[property], property).toBe(button[property]);
    expect(link["border"]).toBe("1px solid var(--color-border)");
    expect(button["border-color"]).toBe("var(--color-border)");
  });
});
