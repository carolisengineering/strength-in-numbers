import { describe, expect, it } from "vitest";

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const routines = raw(import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./**/*.test.tsx"], { query: "?raw", import: "default", eager: true }));
const workoutsAndRecords = raw(
  import.meta.glob(["../workouts/**/*.ts", "../workouts/**/*.tsx", "../records/**/*.ts", "../records/**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
/** Comments and import specifiers are not uses of the key. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/(?:\bfrom\s+|\bimport\s*\(?\s*)["'][^"']+["']/g, "");
const using = (files: Record<string, string>, key: RegExp) =>
  Object.entries(files)
    .filter(([, source]) => key.test(code(source)))
    .map(([path]) => path)
    .sort();

describe("10.5 AC18 — the request keys stay where they belong", () => {
  it("`oneOff` appears only in the routine client, the create hook, the editor's Save and the import route", () => {
    expect(Object.keys(routines).length).toBeGreaterThan(20);
    expect(using(routines, /\boneOff\b/)).toEqual(["./RoutineEditor.tsx", "./import/ImportEdit.tsx", "./routineClient.ts", "./useRoutineMutations.ts"]);
  });

  it("toRoutineInput never emits it", () => {
    expect(routines["./validateDraft.ts"]).toBeDefined();
    expect(code(routines["./validateDraft.ts"]!)).not.toMatch(/oneOff/);
  });

  it("`keepRoutine` appears only in ActiveSession, the finish hook and the workout client", () => {
    expect(using(workoutsAndRecords, /\bkeepRoutine\b/)).toEqual(["../workouts/ActiveSession.tsx", "../workouts/useWorkoutMutations.ts", "../workouts/workoutClient.ts"]);
  });
});

describe("10.5 AC25 — boundaries", () => {
  const specifiers = (source: string) =>
    [...source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

  it.each(["../workouts/FinishDialog.tsx", "../workouts/EndEarlyDialog.tsx"])("%s takes plain props and imports nothing from routines/", (path) => {
    expect(workoutsAndRecords[path]).toBeDefined();
    expect(specifiers(workoutsAndRecords[path]!).filter((s) => s.includes("routines"))).toEqual([]);
    expect(code(workoutsAndRecords[path]!)).not.toMatch(/\b(?:finishLock|confirmFinish|useFinishWorkout)\b/);
  });

  it("the routines key reaches the finish fan-out through records/cache.ts, not workouts/", () => {
    expect(specifiers(workoutsAndRecords["../records/cache.ts"]!)).toContain("../routines/queries");
  });
});
