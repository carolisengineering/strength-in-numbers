import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../../test/sourceScan";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Block comments and `//` line comments; a `//` after a colon is a URL's, not a comment. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (path: string) => stripComments(readFileSync(join(SRC, path), "utf8"));
/** Production code: no tests, and not `src/test/` (Phase A's fakes live there). */
const production = filesUnder(SRC, /\.(ts|tsx)$/)
  .map((path) => relative(SRC, path))
  .filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith("test/"));

describe("20.2 AC27 — no background", () => {
  it.each(["features/hevy/send/useHevyAutoPush.ts", "features/workouts/finishEvents.ts"])("%s names no timer", (path) => {
    expect(read(path)).not.toMatch(/\bset(Timeout|Interval)\b/);
  });
});

describe("20.2 AC29 — one sequence", () => {
  it("only runSend calls Hevy's workout writes (the client declares them); nothing else in features/hevy does", () => {
    const hits = production
      .filter((path) => path.startsWith("features/hevy/"))
      .filter((path) => /\b(create|update)Workout\(/.test(read(path)))
      .sort();
    expect(hits).toEqual(["features/hevy/client/hevyClient.ts", "features/hevy/send/runSend.ts"]);
  });

  it("only runSend and the link read name /hevy-link (the read is a GET)", () => {
    const hits = production.filter((path) => read(path).includes("/hevy-link")).sort();
    expect(hits).toEqual(["features/hevy/send/runSend.ts", "features/hevy/send/useHevyLink.ts"]);
    expect(read("features/hevy/send/useHevyLink.ts")).toMatch(/api\.get\(`\/v1\/workouts\/\$\{workoutId\}\/hevy-link`/);
    expect(read("features/hevy/send/useHevyLink.ts")).not.toMatch(/api\.(post|request|delete)\(/);
  });

  it("auto-push sends only through the runner, create-only", () => {
    const hook = read("features/hevy/send/useHevyAutoPush.ts");
    expect(hook).toContain('runner(workoutId, { kind: "send" }, { createOnly: true, reads })');
    expect(hook).not.toMatch(/\brunSend\(/);
  });
});
