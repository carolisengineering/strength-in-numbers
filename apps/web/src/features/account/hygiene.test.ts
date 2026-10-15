import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Read from disk (a `?raw` glob proved order-dependent when several test files ran in one worker).
const here = dirname(fileURLToPath(import.meta.url));
const sourceOf = (path: string): string => readFileSync(join(here, path), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (source: string) => [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

const ADDED = [
  "./messages.ts", "./saveBlob.ts", "./failureCopy.ts", "./formatEraseDate.ts", "./accountDeleted.ts",
  "./useExportAccount.ts", "./ExportControl.tsx", "./AccountDataSection.tsx",
  "./useDeleteAccount.ts", "./AccountDeletedConfirmation.tsx", "./DeleteAccountSection.tsx",
];

const ALLOWED_PACKAGES = new Set(["@sin/core", "@tanstack/react-query", "react", "@auth0/auth0-react"]);
const ALLOWED_PREFIXES = [
  "./", "../../ui/", "../../api/", "../../auth/", "../../observability/reportError", "../me/useMe",
];

describe("12 AC24 — hygiene and boundaries", () => {
  it("names neither localStorage nor sessionStorage (comments included)", () => {
    for (const path of ADDED) expect(sourceOf(path), path).not.toMatch(/localStorage|sessionStorage/);
  });

  it("has no dangerouslySetInnerHTML, innerHTML or style= attribute", () => {
    for (const path of ADDED) expect(stripComments(sourceOf(path)), path).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\bstyle\s*=/);
  });

  it("never JSON.parse / JSON.stringify the export Blob", () => {
    for (const path of ["./useExportAccount.ts", "./saveBlob.ts", "./ExportControl.tsx"]) {
      expect(stripComments(sourceOf(path)), path).not.toMatch(/JSON\.(parse|stringify)\s*\(/);
    }
  });

  it("contains no numeric literal 30 (the grace days come from @sin/core)", () => {
    for (const path of ADDED) expect(stripComments(sourceOf(path)), path).not.toMatch(/\b30\b/);
  });

  it("imports only the allowed packages and project folders", () => {
    for (const path of ADDED) {
      const bad = imports(sourceOf(path)).filter(
        (i) => !ALLOWED_PACKAGES.has(i) && !ALLOWED_PREFIXES.some((prefix) => i.startsWith(prefix)),
      );
      expect(bad, path).toEqual([]);
    }
  });

  it("adds no track() call and no USER_DATA_KEY_PREFIXES entry", () => {
    for (const path of ADDED) {
      const source = sourceOf(path);
      expect(imports(source).filter((i) => /observability\/track/.test(i)), path).toEqual([]);
      expect(source, path).not.toMatch(/\btrack\s*\(|USER_DATA_KEY_PREFIXES/);
    }
  });

  it("passes no export content, filename or message text to track / reportError / console", () => {
    const withReport = ADDED.filter((path) => /\breportError\b/.test(stripComments(sourceOf(path))));
    expect(withReport).toEqual(["./useExportAccount.ts"]);
    const source = stripComments(sourceOf("./useExportAccount.ts"));
    const calls = [...source.matchAll(/reportError\s*\(([^;]*);/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^\s*error,\s*\{ source: "account-export" \}\)$/);
    for (const path of ADDED) expect(stripComments(sourceOf(path)), path).not.toMatch(/\bconsole\./);
  });
});
