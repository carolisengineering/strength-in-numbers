import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkoutDetailSchema } from "@sin/core";
import { USER_DATA_KEY_PREFIXES } from "../../../storage/clearUserData";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const imports = (source: string) => [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);
/** Every non-test source file Spec 10.6 adds under `sections/`. */
const SOURCES = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const STYLES = readdirSync(here).filter((f) => f.endsWith(".module.css"));

describe("10.6 AC27 — boundaries", () => {
  it("the folder holds the spec's modules", () => {
    expect(SOURCES.sort()).toEqual(
      [
        "NewExercisesLine.tsx",
        "SectionDialogs.tsx",
        "SectionPicker.tsx",
        "SectionSheet.tsx",
        "resolveSectionFailure.ts",
        "sectionCopy.ts",
        "sectionFields.ts",
        "sectionMutations.ts",
        "useSectionActions.ts",
        "useSectionMutations.ts",
      ].sort(),
    );
  });

  it("sections/ imports nothing from routines/", () => {
    const hits = SOURCES.flatMap((f) => imports(read(f)).filter((i) => /(^|\/)routines\//.test(i)).map((i) => `${f}: ${i}`));
    expect(hits).toEqual([]);
  });

  it("sections/ imports nothing from the outbox, drafts, rest store, logAction or finishLock", () => {
    const banned = /(outbox\/|drafts\/|restStore|logAction|finishLock)/;
    const hits = SOURCES.flatMap((f) => imports(read(f)).filter((i) => banned.test(i)).map((i) => `${f}: ${i}`));
    expect(hits).toEqual([]);
  });

  it("only useSectionMutations names the live client or the active-workout key; the shared hook and dialogs take everything by injection", () => {
    const live = SOURCES.filter((f) => /useWorkoutClient|WORKOUT_KEYS/.test(stripComments(read(f))));
    expect(live).toEqual(["useSectionMutations.ts"]);
  });
});

describe("10.6 AC27 — boundaries with the edit screen", () => {
  const editDir = join(here, "..", "edit");
  const EDIT_SOURCES = readdirSync(editDir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  const ALLOWED = new Set(["useSectionActions", "SectionDialogs", "NewExercisesLine", "sectionCopy", "sectionMutations", "SectionPicker"]);

  it("sections/ imports nothing from edit/", () => {
    const hits = SOURCES.flatMap((f) => imports(read(f)).filter((i) => /(^|\/)edit\//.test(i)).map((i) => `${f}: ${i}`));
    expect(hits).toEqual([]);
  });

  it("edit/ imports sections/ only through the shared controls, never the live hook", () => {
    const used = EDIT_SOURCES.flatMap((f) =>
      imports(readFileSync(join(editDir, f), "utf8"))
        .filter((i) => /(^|\/)sections\//.test(i))
        .map((i) => i.split("/").at(-1)!),
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((m) => !ALLOWED.has(m))).toEqual([]);
  });
});

describe("10.6 AC24 — text as text, no new storage", () => {
  it("no dangerouslySetInnerHTML, innerHTML, style= or <style in sections/", () => {
    const hits = SOURCES.filter((f) => /dangerouslySetInnerHTML|innerHTML|style=|<style/.test(stripComments(read(f))));
    expect(hits).toEqual([]);
  });

  it("no browser storage in sections/, and the user-data prefixes are unchanged", () => {
    expect(SOURCES.filter((f) => /localStorage|sessionStorage|StorageAdapter|sin:/.test(stripComments(read(f))))).toEqual([]);
    expect(USER_DATA_KEY_PREFIXES).toStrictEqual(["sin:catalog:", "sin:recents:", "sin:workout:", "sin:hevy:"]);
  });
});

describe("10.6 AC24 — a long name wraps instead of overflowing", () => {
  it("the section heading, the line and the sheet's text wrap anywhere", () => {
    const rule = (css: string, selector: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(readFileSync(join(here, "../SessionSectionHeading.module.css"), "utf8"), ".name")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(read("NewExercisesLine.module.css"), ".line")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(readFileSync(join(here, "../../../ui/ConfirmDialog.module.css"), "utf8"), ".title")).toMatch(/overflow-wrap:\s*anywhere/); // "Remove {name}?"
  });
});

describe("10.6 AC23 — strict parse", () => {
  it("a workout section without addedInWorkout fails to parse", () => {
    const detail = makeWorkoutDetail({ sections: [{ name: "Warm-up" }] });
    expect(WorkoutDetailSchema.safeParse(detail).success).toBe(true);
    const section: Record<string, unknown> = { ...detail.sections[0]! };
    delete section["addedInWorkout"];
    expect(WorkoutDetailSchema.safeParse({ ...detail, sections: [section] }).success).toBe(false);
  });
});

describe("10.6 AC26 — tokens", () => {
  it("every value in the sections stylesheets is a token (var(--…)), a 1px border width, or 0", () => {
    const loose: string[] = [];
    for (const file of STYLES) {
      for (const [, prop, value] of read(file).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([a-z-]+):\s*([^;]+);/g)) {
        const rest = value!.replace(/var\(--[a-z0-9-]+\)/g, "").replace(/100%/g, "").replace(/\b(1px|0|solid|vertical|column|flex|wrap|anywhere|pre-wrap|600|space-between|baseline)\b/g, "").trim();
        if (rest !== "") loose.push(`${file} ${prop}: ${value}`);
      }
    }
    expect(loose).toEqual([]);
  });

  it("no brass (records only) and teal only through Button in sections/", () => {
    const all = STYLES.map(read).join("\n");
    expect(all).not.toMatch(/--color-pr|--color-signal/);
  });
});
