import { describe, expect, it } from "vitest";
import { RoutineWriteSchema, SECTION_NAME_MAX, SECTION_NOTES_MAX } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { sectioned } from "../../test/sectionedDraft";
import { actions, initialDraft, reduce, type Draft } from "./routineDraft";
import { parseSectionName, parseSectionNotes } from "./sectionText";
import {
  SECTION_NAME_REQUIRED,
  SECTION_NAME_TOO_LONG,
  SECTION_NOTES_INVALID,
  SECTION_NOTES_TOO_LONG,
} from "./messages";
import { FORM_INVALID, toRoutineInput, validateDraft } from "./validateDraft";

const opts = { exerciseState: () => "active" as const, modalityOf: () => null };
const body = (d: Draft) => toRoutineInput(d, { modalityOf: () => null });

describe("10.3 AC7 — the request body", () => {
  it("a draft with no section sends today's body: no `sections` key, no `sectionKey` on any item", () => {
    const d = { ...sectioned("a b"), name: "Plain", notes: "" };
    const out = body(d);
    expect(Object.keys(out)).toEqual(["name", "items"]);
    expect(out.items.every((i) => !("sectionKey" in i))).toBe(true);
  });

  it("a sectioned draft sends s1…sN in section order, sectionKey on sectioned items only, a blank note omitted; draft keys never leave", () => {
    const d: Draft = {
      ...sectioned("x", ["W", "a"], ["M", "b1 c1"]),
      sections: [
        { key: "W", name: " Warm-up ", notes: "5 min rower " },
        { key: "M", name: "Main", notes: "  " },
      ],
    };
    const out = body(d);
    expect(out.sections).toEqual([{ key: "s1", name: "Warm-up", notes: "5 min rower" }, { key: "s2", name: "Main" }]);
    expect(out.items.map((i) => i.sectionKey ?? "loose")).toEqual(["loose", "s1", "s2", "s2"]);
    expect(out.items.map((i) => i.supersetGroup)).toEqual([null, null, 1, 1]);
    const json = JSON.stringify(out);
    expect(json).not.toContain('"W"'); // the draft's own section keys never leave
    expect(json).not.toContain('"M"');
    expect(RoutineWriteSchema.safeParse(out).success).toBe(true);
  });

  it("positions are never sent", () => {
    expect(JSON.stringify(body(sectioned("", ["W", "a"])))).not.toContain("position");
  });
});

describe("10.3 AC8 — validation", () => {
  const named = (name: string, notes = ""): Draft => ({ ...sectioned("", ["W", "a"]), name: "R", sections: [{ key: "W", name, notes }] });
  const sectionIssues = (d: Draft) => validateDraft(d, opts).issues.filter((i) => i.scope === "section");

  it.each([
    ["a blank name", "  ", "", SECTION_NAME_REQUIRED, "name"],
    [`a name over ${SECTION_NAME_MAX}`, "x".repeat(SECTION_NAME_MAX + 1), "", SECTION_NAME_TOO_LONG, "name"],
    [`notes over ${SECTION_NOTES_MAX}`, "Main", "y".repeat(SECTION_NOTES_MAX + 1), SECTION_NOTES_TOO_LONG, "notes"],
    ["control characters in the notes", "Main", "a\u0001b", SECTION_NOTES_INVALID, "notes"],
  ])("%s → one section issue, in the app's wording, never echoing the input", (_label, name, notes, message, field) => {
    const issues = sectionIssues(named(name, notes));
    expect(issues).toEqual([{ scope: "section", sectionKey: "W", field, message }]);
    expect(JSON.stringify(issues)).not.toContain("xxxxx");
    expect(JSON.stringify(issues)).not.toContain("yyyyy");
  });

  it("boundaries agree with RoutineWriteSchema: 40 / 2000 pass, 41 / 2001 fail", () => {
    for (const [name, notes, ok] of [
      ["x".repeat(40), "", true],
      ["x".repeat(41), "", false],
      ["Main", "y".repeat(2000), true],
      ["Main", "y".repeat(2001), false],
    ] as const) {
      expect(sectionIssues(named(name, notes)).length === 0, `${name.length}/${notes.length}`).toBe(ok);
      expect(RoutineWriteSchema.safeParse(body(named(name, notes))).success).toBe(ok);
    }
  });

  it("code points, not UTF-16 units: forty emoji are allowed", () => {
    expect(sectionIssues(named("🏋".repeat(40)))).toEqual([]);
  });

  it("a structure the reducer can never build (a loose item after a sectioned one) is a form-level issue and flags the bug", () => {
    const broken: Draft = { ...sectioned("", ["M", "b"]), name: "R", items: [...sectioned("", ["M", "b"]).items, ...sectioned("z").items] };
    const result = validateDraft(broken, opts);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ scope: "form", message: FORM_INVALID });
    expect(result.groupBug).toBe(true);
  });

  it("a draft the reducer built is valid", () => {
    let d = reduce(initialDraft(), actions.rename("Plan"));
    d = reduce(d, actions.addSection("Main"));
    d = reduce(d, actions.add(exerciseId(1)));
    expect(validateDraft(d, opts)).toMatchObject({ ok: true, groupBug: false });
  });
});

describe("10.3 AC8 — the sheet parsers", () => {
  it.each([
    ["Warm-up", { ok: true, value: "Warm-up" }],
    ["  Main  ", { ok: true, value: "Main" }],
    ["", { ok: false, message: SECTION_NAME_REQUIRED }],
    ["x".repeat(41), { ok: false, message: SECTION_NAME_TOO_LONG }],
  ])("parseSectionName(%j)", (text, expected) => {
    expect(parseSectionName(text)).toEqual(expected);
  });
  it("parseSectionNotes returns the text as typed (so an untouched Done changes nothing) and refuses over-long / control characters", () => {
    expect(parseSectionNotes("5 min\nthen bands ")).toEqual({ ok: true, value: "5 min\nthen bands " });
    expect(parseSectionNotes("")).toEqual({ ok: true, value: "" });
    expect(parseSectionNotes("y".repeat(2001))).toEqual({ ok: false, message: SECTION_NOTES_TOO_LONG });
    expect(parseSectionNotes("a\u0007")).toEqual({ ok: false, message: SECTION_NOTES_INVALID });
  });
});
