import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The one place this package is allowed to reach outside the standard library.
// DESIGN §3.4 / Spec 02 §2 AC3: keep the browser-shipped dependency surface tiny.
const ALLOWED_RUNTIME_DEPS = ["zod"];

describe("AC3 — runtime-dependency allowlist", () => {
  it("package.json dependencies is exactly the allowlist", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([...ALLOWED_RUNTIME_DEPS].sort());
  });
});
