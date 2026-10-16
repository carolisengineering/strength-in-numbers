import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Spec 17.0 §6.10: the screenshot harness lives in apps/web/scripts/screens and must stay a dev tool.
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(WEB, "src");
const HARNESS = join(WEB, "scripts", "screens");

function files(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, match, out);
    else if (match.test(name)) out.push(path);
  }
  return out;
}

describe("AC18 — the screenshot harness is portable", () => {
  it("names no machine-specific path", () => {
    const offenders = files(HARNESS, /\.(mjs|js|md)$/).filter((f) => /\/Users\/|\/home\/|[A-Z]:\\\\/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("is a package script that writes into the gitignored .screens directory", () => {
    const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.screens).toBe("node scripts/screens/run.mjs");
    expect(readFileSync(join(WEB, "..", "..", ".gitignore"), "utf8")).toMatch(/^apps\/web\/\.screens\/$/m);
  });
});

describe("AC19 — the harness's fake Auth0 cannot reach production", () => {
  it("is aliased only by the harness's own Vite config", () => {
    expect(readFileSync(join(HARNESS, "vite.config.mjs"), "utf8")).toContain("fake-auth0-react.js");
    expect(readFileSync(join(WEB, "vite.config.ts"), "utf8")).not.toMatch(/scripts\/screens|fake-auth0/);
  });

  it("is never referenced from src/**", () => {
    const offenders = files(SRC, /\.(ts|tsx|css)$/)
      .filter((f) => !f.endsWith("screensHarness.test.ts"))
      .filter((f) => /scripts\/screens|fake-auth0-react/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("carries the marker that assert-build-output searches dist/ for", () => {
    const marker = "sin-screens-harness-fake-auth";
    expect(readFileSync(join(HARNESS, "fake-auth0-react.js"), "utf8")).toContain(marker);
    expect(readFileSync(join(WEB, "scripts", "assert-build-output.mjs"), "utf8")).toContain(marker);
  });
});
