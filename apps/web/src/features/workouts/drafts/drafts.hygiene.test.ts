import { describe, expect, it } from "vitest";
import { USER_DATA_KEY_PREFIXES } from "../../../storage/clearUserData";

const files = import.meta.glob(["../*.ts", "../*.tsx", "./*.ts", "./*.tsx", "!../*.test.ts", "!../*.test.tsx", "!./*.test.ts", "!./*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const allSource = import.meta.glob(["../../../**/*.ts", "../../../**/*.tsx", "!../../../**/*.test.ts", "!../../../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const NEW = ["./draftStore.ts", "./DraftStoreContext.ts", "./useDraftPersistence.ts", "../logoutGuard.ts", "../messages.ts", "../useLogoutGuard.tsx"];

describe("06.5 AC25 — hygiene scans", () => {
  it("the scan reads every new file (it cannot pass vacuously)", () => {
    for (const p of NEW) expect(files[p], p).toBeTruthy();
  });

  it("(a) the only storage key the new files name is sin:workout:drafts, under an existing prefix", () => {
    const keys = NEW.flatMap((p) => [...stripComments(files[p] ?? "").matchAll(/["'`](sin:[a-z-]+:[^"'`]*)["'`]/g)].map((m) => m[1]));
    expect([...new Set(keys)]).toEqual(["sin:workout:drafts"]);
    expect(USER_DATA_KEY_PREFIXES).toEqual(["sin:catalog:", "sin:recents:", "sin:workout:"]);
  });

  it("(b) no new non-test file names the browser storage globals, comments included", () => {
    for (const p of NEW) expect(files[p] ?? "", p).not.toMatch(/localStorage|sessionStorage/);
  });

  it("(c) no draft value or guard object reaches track, reportError or console", () => {
    for (const p of NEW) {
      const src = stripComments(files[p] ?? "");
      expect(src, p).not.toMatch(/\btrack\(|console\./);
      for (const call of src.matchAll(/reportError\(([^)]*)\)/g)) {
        expect(call[1], p).toMatch(/^\s*error\s*,\s*\{\s*source:\s*"workout-drafts"\s*\}\s*$/);
      }
    }
  });

  it("(d) only logout.ts builds logoutParams", () => {
    const offenders = Object.entries(allSource).filter(([p, s]) => /logoutParams/.test(stripComments(s)) && !p.endsWith("/auth/logout.ts"));
    expect(offenders.map(([p]) => p)).toEqual([]);
  });
});

describe("06.5 AC19 — the guard touches no other logout path", () => {
  it("useLogoutGuard is imported by ProfileScreen only", () => {
    const importers = Object.entries(allSource)
      .filter(([, s]) => /from\s+["'][^"']*useLogoutGuard["']/.test(stripComments(s)))
      .map(([p]) => p);
    expect(importers).toHaveLength(1);
    expect(importers[0]).toMatch(/\/me\/ProfileScreen\.tsx$/);
  });

  it("useSession.ts and logout.ts do not import from features/workouts", () => {
    const scanned = Object.entries(allSource).filter(([p]) => /auth\/(useSession|logout)\.ts$/.test(p));
    expect(scanned).toHaveLength(2);
    for (const [p, s] of scanned) expect(stripComments(s), p).not.toMatch(/features\/workouts/);
  });
});
