import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** A fixed string: `"…"`, `{"…"}`, or a template with no interpolation (minor 721). */
const FIXED = String.raw`(?:"[^"]*"|\{"[^"]*"\}|\{` + "`" + String.raw`(?:(?!\$\{)[^` + "`" + String.raw`])*` + "`" + String.raw`\})`;
const FIXED_NAME = new RegExp(String.raw`\bname=` + FIXED);
const FIXED_PREFIX = new RegExp(String.raw`\bidPrefix=` + FIXED);

/**
 * Minor 721: the components that build a Segmented's name from their `idPrefix` (checked below), so a fixed prefix
 * given to one of them is a fixed radio name.
 */
const NAME_FROM_PREFIX = ["TimerFields", "SetFields"];

/** Each fixed Segmented name in `text`, directly or through a listed component's prefix. */
function fixedNames(text: string): string[] {
  const found: string[] = [];
  for (const tag of tagsOf(text, "Segmented")) {
    const hit = FIXED_NAME.exec(tag);
    if (hit) found.push(hit[0]);
  }
  for (const component of NAME_FROM_PREFIX) {
    for (const tag of tagsOf(text, component)) {
      const hit = FIXED_PREFIX.exec(tag);
      if (hit) found.push(`<${component} ${hit[0]}`);
    }
  }
  return found;
}

/** Each opening tag of `component`, up to its `/>`. */
function tagsOf(text: string, component: string): string[] {
  const tags: string[] = [];
  const start = new RegExp(`<${component}\\b`, "g");
  for (let m = start.exec(text); m; m = start.exec(text)) tags.push(text.slice(m.index, text.indexOf("/>", m.index)));
  return tags;
}

describe("minors 444, 493 — a Segmented's radio name is never a fixed string", () => {
  it("every <Segmented …> passes a name built from useId (or a prefix that is), so two mounted strips never share a group", () => {
    const fixed: string[] = [];
    for (const file of sources(SRC)) {
      for (const hit of fixedNames(readFileSync(file, "utf8"))) fixed.push(`${relative(SRC, file)}: ${hit}`);
    }
    expect(fixed).toEqual([]);
  });

  it("minor 721: each listed component still builds a Segmented name from its prefix", () => {
    const read = (path: string) => readFileSync(join(SRC, path), "utf8");
    expect(read("features/sectionTimer/TimerFieldGroup.tsx")).toContain("name={`${idPrefix}-");
    const setFields = read("features/workouts/SetFields.tsx");
    expect(setFields).toContain("`${props.idPrefix}-");
    expect(setFields).toContain("<Segmented name={id(");
  });

  it("minor 721: the samples", () => {
    for (const sample of ["<Segmented name={`fixed`} />", '<Segmented name={"fixed"} />', '<TimerFields idPrefix="section-timer" />']) {
      expect(fixedNames(sample), sample).toHaveLength(1);
    }
    for (const sample of ["<SetFields idPrefix={`edit-${set.id}`} />", "<TimerFields idPrefix={formId} />", "<Segmented name={id(\"weight-unit\")} />"]) {
      expect(fixedNames(sample), sample).toEqual([]);
    }
  });
});
