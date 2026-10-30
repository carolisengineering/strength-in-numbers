import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");
/** Block comments and `//` line comments; a `//` after a colon is a URL's, not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const production = filesUnder(SRC, /\.(ts|tsx)$/)
  .map((path) => relative(SRC, path))
  .filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith("test/"));
const read = (path: string) => stripComments(readFileSync(join(SRC, path), "utf8"));
const importsFrom = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

/**
 * Amended by Spec 20.1 (owner ruling 2026-10-29): the import's session hook alone may use the routines list and the
 * routine create (20.1 D11). Nothing else in `features/hevy/` imports `features/routines/`.
 */
const ROUTINES_EXEMPT_FILE = "features/hevy/import/useImportSession.ts";
const ROUTINES_EXEMPT_MODULES = /(^|\/)routines\/(queries|useRoutineMutations)$/;

describe("20.0 AC31 — import boundaries", () => {
  it("no features/hevy file imports from features/routines, but the import's session hook (two modules)", () => {
    const hits = production
      .filter((path) => path.startsWith("features/hevy/"))
      .flatMap((path) =>
        importsFrom(read(path))
          .filter((spec) => /(^|\/)routines\//.test(spec))
          .filter((spec) => !(path === ROUTINES_EXEMPT_FILE && ROUTINES_EXEMPT_MODULES.test(spec)))
          .map((spec) => `${path} → ${spec}`),
      );
    expect(hits).toEqual([]);
  });

  it("20.1 — the exempt hook does use the routines list and the create (so the exemption is not stale)", () => {
    const specs = importsFrom(read(ROUTINES_EXEMPT_FILE));
    expect(specs.some((spec) => /(^|\/)routines\/queries$/.test(spec))).toBe(true);
    expect(specs.some((spec) => /(^|\/)routines\/useRoutineMutations$/.test(spec))).toBe(true);
  });

  it("only features/hevy/client names api.hevyapp.com", () => {
    const hits = production.filter((path) => !path.startsWith("features/hevy/client/") && read(path).includes("api.hevyapp.com"));
    expect(hits).toEqual([]);
  });

  it("no features/catalog file imports from features/hevy", () => {
    const hits = production
      .filter((path) => path.startsWith("features/catalog/"))
      .filter((path) => importsFrom(read(path)).some((spec) => /(^|\/)hevy\//.test(spec)));
    expect(hits).toEqual([]);
  });
});

/** `import [type] { a, b } from "spec"` (and default / namespace imports), with the names and whether it is type-only. */
const importStatements = (source: string) =>
  [...source.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)].map((m) => ({
    typeOnly: m[1] !== undefined,
    names: (/\{([^}]*)\}/.exec(m[2]!)?.[1] ?? m[2]!)
      .split(",")
      .map((n) => n.trim().replace(/^type\s+/, ""))
      .filter((n) => n !== ""),
    spec: m[3]!,
  }));

describe("20.2 AC1 — import boundary", () => {
  it("features/workouts imports only HevyWorkoutSection and HevyDeleteNote, from features/hevy/send", () => {
    const hits = production
      .filter((path) => path.startsWith("features/workouts/"))
      .flatMap((path) =>
        importStatements(read(path))
          .filter((i) => /(^|\/)hevy(\/|$)/.test(i.spec))
          .filter((i) => !(/^(\.\.\/)+hevy\/send$/.test(i.spec) && i.names.every((n) => n === "HevyWorkoutSection" || n === "HevyDeleteNote")))
          .map((i) => `${path} → ${i.spec} {${i.names.join(", ")}}`),
      );
    expect(hits).toEqual([]);
  });

  it("features/hevy imports from features/workouts only queries, finishEvents, or types", () => {
    const hits = production
      .filter((path) => path.startsWith("features/hevy/"))
      .flatMap((path) =>
        importStatements(read(path))
          .filter((i) => /(^|\/)workouts\//.test(i.spec))
          .filter((i) => !i.typeOnly && !/(^|\/)workouts\/(queries|finishEvents)$/.test(i.spec))
          .map((i) => `${path} → ${i.spec}`),
      );
    expect(hits).toEqual([]);
  });

  it("the section is wired in (so the scan is not vacuous)", () => {
    expect(importsFrom(read("features/workouts/FinishedWorkoutScreen.tsx"))).toContain("../hevy/send");
  });
});
