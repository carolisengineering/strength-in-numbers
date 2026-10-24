import { describe, expect, it } from "vitest";

// Raw source of every non-test module under edit/ (Spec 18.0 AC46).
const editSources = import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
// Spec 18.0 Phase B: the Change Time modules are held to the same rules, plus no `useNow` (17.1 AC49).
const changeTimeSources = import.meta.glob(["../changeTime/**/*.ts", "../changeTime/**/*.tsx", "!../changeTime/**/*.test.ts", "!../changeTime/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
// Spec 10.6 AC18: the shared section modules the edit screen renders (everything but the live hook file).
const sharedSectionSources = import.meta.glob(
  ["../sections/**/*.ts", "../sections/**/*.tsx", "!../sections/**/*.test.ts", "!../sections/**/*.test.tsx", "!../sections/useSectionMutations.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const activeSession = import.meta.glob("../ActiveSession.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const liveScreens = import.meta.glob(["../ActiveSession.tsx", "../StartWorkout.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const corsMethods = import.meta.glob("../../../../../api/src/plugins/cors-methods.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Code only: a comment that explains why something is avoided is not a use of it. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIVE_MACHINERY =
  /\buseOutbox\b|\buseDraftStores\b|\buseRestStores?\b|\bLogActionContext\b|\bSET_MUTATION_KEY\b|WORKOUT_KEYS\.active|\blocalStorage\b|\bsessionStorage\b|dangerouslySetInnerHTML/;

describe("18.0 AC46 — edit modules stay off the live machinery", () => {
  it("found the sources it is meant to scan", () => {
    expect(Object.keys(editSources).length).toBeGreaterThanOrEqual(9); // incl. DetailsSheet, details, EditNoteSheet, editCache
  });

  it("no edit module names the outbox, drafts, rest store, log action, the live set key, the active key or browser storage", () => {
    const offenders = Object.entries(editSources)
      .filter(([, source]) => LIVE_MACHINERY.test(stripComments(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the Change Time modules name none of them, nor useNow", () => {
    expect(Object.keys(changeTimeSources).length).toBeGreaterThanOrEqual(3);
    const offenders = Object.entries(changeTimeSources)
      .filter(([, source]) => LIVE_MACHINERY.test(stripComments(source)) || /\buseNow\b/.test(stripComments(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("10.6 AC18 — the edit section hook is scanned, and no edit module imports the live section hook", () => {
    expect(Object.keys(editSources)).toContain("./useEditSectionMutations.ts");
    const offenders = Object.entries(editSources)
      .filter(([, source]) => /sections\/useSectionMutations/.test(stripComments(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("10.6 AC18 — the shared section modules the edit screen uses name none of the live machinery", () => {
    expect(Object.keys(sharedSectionSources).length).toBeGreaterThanOrEqual(8);
    const offenders = Object.entries(sharedSectionSources)
      .filter(([, source]) => LIVE_MACHINERY.test(stripComments(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("ActiveSession gains no edit-mode branch", () => {
    const source = Object.values(activeSession)[0]!;
    expect(source).not.toMatch(/ScreenModeContext|useScreenMode/);
  });

  it("the CORS method list already holds PATCH, POST and DELETE (no change needed)", () => {
    const source = Object.values(corsMethods)[0]!;
    for (const method of ["PATCH", "POST", "DELETE"]) expect(source).toContain(`"${method}"`);
  });
});

describe("18.0 AC58 — the live screen is unchanged", () => {
  it("ActiveSession and the Start screen read no workout title or notes", () => {
    expect(Object.keys(liveScreens)).toHaveLength(2);
    for (const [path, source] of Object.entries(liveScreens)) {
      expect([path, /\bworkout\.(title|notes)\b/.test(stripComments(source))]).toEqual([path, false]);
    }
  });
});
