import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs module of the web package, imported by path (spec §10)
import { checkCacheControl, checkCommitMeta, expectedCspFrom } from "../../../web/scripts/lib/web-smoke-checks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("15 AC23 — web smoke checks", () => {
  it.each([
    ["/", "public, max-age=0, must-revalidate", true],
    ["/", "no-cache", true],
    ["/", "public, max-age=3600", false],
    ["/", null, false],
    ["/assets", "public, max-age=31536000, immutable", true],
    ["/assets", "public, max-age=3600", false],
    ["/assets", "public, max-age=0, must-revalidate", false],
  ])("Cache-Control on %s: %s → ok %s", (path, value, ok) => expect(checkCacheControl(path, value) === null).toBe(ok));

  it("checkCommitMeta: match, mismatch, absent, and no expectation", () => {
    expect(checkCommitMeta(`<meta name="sin-commit" content="${SHA}">`, SHA)).toBeNull();
    expect(checkCommitMeta(`<meta name="sin-commit" content="dev">`, SHA)).toMatch(/dev/);
    expect(checkCommitMeta("<html></html>", SHA)).not.toBeNull();
    expect(checkCommitMeta("<html></html>", undefined)).toBeNull();
  });

  it("expectedCspFrom reads the Firebase config's CSP", () =>
    expect(expectedCspFrom("firebase", join(HERE, "../fixtures/hosting"))).toBe("default-src 'self'; connect-src 'self' https://api.example"));
  it("expectedCspFrom reads render.yaml's staging CSP from the repo", () =>
    expect(expectedCspFrom("render", join(HERE, "../../../.."))).toMatch(/^default-src 'self'/));
});
