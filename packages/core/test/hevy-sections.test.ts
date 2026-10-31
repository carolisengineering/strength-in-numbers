import { describe, expect, it } from "vitest";
import { SECTION_DEFAULT_RULES, SECTION_NAME_MAX, sectionFromPlaceholder, sectionKey, sectionTreatment } from "../src/index.js";

describe("19.0 AC10 — section treatment", () => {
  it("the defaults: Warm-up gets a marker, Accessory goes on the first exercise", () => {
    expect(SECTION_DEFAULT_RULES).toEqual([
      { name: "Warm-up", treatment: "warmup_placeholder" },
      { name: "Accessory", treatment: "notes_on_first" },
    ]);
  });

  it.each([
    ["  warm-UP ", "warmup_placeholder"],
    ["Warm-up", "warmup_placeholder"],
    ["ACCESSORY", "notes_on_first"],
    ["Finisher", "workout_placeholder"],
  ] as const)("Review Focus 3: %j with no user rules is %s", (name, treatment) => {
    expect(sectionTreatment(name, [])).toBe(treatment);
  });

  it("a user rule beats the default, matched on the trimmed lowercase name", () => {
    expect(sectionTreatment("Accessory", [{ name: "accessory ", treatment: "workout_placeholder" }])).toBe("workout_placeholder");
  });

  it("sectionKey trims and lowercases", () => {
    expect(sectionKey("  Warm-UP ")).toBe("warm-up");
  });
});

describe("19.0 AC10 — sections from Hevy placeholders", () => {
  it("a warm-up placeholder starts Warm-up with its notes as the section note", () => {
    expect(sectionFromPlaceholder("warmup_placeholder", "Easy row")).toEqual({ name: "Warm-up", note: "Easy row", notices: [] });
  });

  it("a workout placeholder is named by its first line; the rest, trimmed, is the note", () => {
    expect(sectionFromPlaceholder("workout_placeholder", " EMOM 12 \n  every minute \n row ")).toEqual({
      name: "EMOM 12",
      note: "every minute\nrow",
      notices: [],
    });
  });

  it.each([null, "", "   \n  "])("a workout placeholder with notes %j is Workout, no note", (notes) => {
    expect(sectionFromPlaceholder("workout_placeholder", notes)).toEqual({ name: "Workout", note: null, notices: [] });
  });

  it("a warm-up placeholder with no notes has no note", () => {
    expect(sectionFromPlaceholder("warmup_placeholder", null)).toEqual({ name: "Warm-up", note: null, notices: [] });
  });

  it("a 50-character name is cut to 40", () => {
    const r = sectionFromPlaceholder("workout_placeholder", "x".repeat(50));
    expect(r.name).toHaveLength(40);
    expect(r.notices).toEqual(["section_name_cut"]);
  });

  it("a 2,100-character note is cut to 2000", () => {
    const r = sectionFromPlaceholder("warmup_placeholder", "y".repeat(2100));
    expect(r.note).toHaveLength(2000);
    expect(r.notices).toEqual(["section_note_cut"]);
  });

  it("a cut note does not end in a space", () => {
    const r = sectionFromPlaceholder("warmup_placeholder", `${"y".repeat(1999)} zzz`);
    expect(r.note).toBe("y".repeat(1999));
  });

  it("a cut never splits a surrogate pair (deferred minor 136)", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const named = sectionFromPlaceholder("workout_placeholder", `${"x".repeat(39)}\u{1F4AA}zzz`);
    expect(named.name).toBe("x".repeat(39));
    expect(named.notices).toEqual(["section_name_cut"]);
    const noted = sectionFromPlaceholder("warmup_placeholder", `${"y".repeat(1999)}\u{1F4AA}zzz`);
    expect(noted.note).toBe("y".repeat(1999));
    expect(noted.note).not.toMatch(lone);
    expect(noted.notices).toEqual(["section_note_cut"]);
  });
});

describe("Minor 146 — a cut never ends inside a cluster", () => {
  const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
  const trailingRegional = (s: string) => {
    let n = 0;
    for (const ch of [...s].reverse()) {
      if (!isRegional(ch.codePointAt(0)!)) break;
      n++;
    }
    return n;
  };
  const a = (n: number) => "a".repeat(n);

  it.each([
    // 👩‍💻 is U+1F469 U+200D U+1F4BB (5 units): the limit falls just after the ZWJ.
    ["inside a ZWJ sequence", `${a(SECTION_NAME_MAX - 3)}👩‍💻`, a(SECTION_NAME_MAX - 3)],
    // 🇺🇸 is two regional indicators (4 units): the limit falls between them.
    ["between a flag's two halves", `${a(SECTION_NAME_MAX - 2)}🇺🇸`, a(SECTION_NAME_MAX - 2)],
    // The limit falls after the e, before its combining acute.
    ["after a letter, before its combining mark", `${a(SECTION_NAME_MAX - 1)}é`, a(SECTION_NAME_MAX - 1)],
    // The limit falls between a letter's two combining marks.
    ["between two combining marks", `${a(SECTION_NAME_MAX - 2)}ẹ́`, a(SECTION_NAME_MAX - 2)],
  ])("a name cut %s keeps the cluster whole", (_label, line, expected) => {
    const r = sectionFromPlaceholder("workout_placeholder", line);
    expect(r.notices).toEqual(["section_name_cut"]);
    expect(r.name).toBe(expected);
    expect(r.name.endsWith("‍")).toBe(false);
    expect(/\p{M}$/u.test(r.name)).toBe(false);
    expect(trailingRegional(r.name) % 2).toBe(0);
  });

  it("whole flags before the cut are kept", () => {
    const r = sectionFromPlaceholder("workout_placeholder", `${a(SECTION_NAME_MAX - 8)}🇺🇸🇫🇷🇩🇪`);
    expect(r.name).toBe(`${a(SECTION_NAME_MAX - 8)}🇺🇸🇫🇷`);
  });

  it("a note that is one cluster longer than the limit is no note, never an empty string", () => {
    const r = sectionFromPlaceholder("warmup_placeholder", `H${"́".repeat(2100)}`);
    expect(r.note).toBeNull();
    expect(r.notices).toEqual(["section_note_cut"]);
  });

  it("a name that is one cluster longer than the limit falls back to Workout", () => {
    const r = sectionFromPlaceholder("workout_placeholder", `H${"́".repeat(60)}`);
    expect(r.name).toBe("Workout");
  });

  it("Minor 214 — a name replaced by Workout reports no cut", () => {
    const r = sectionFromPlaceholder("workout_placeholder", `H${"́".repeat(60)}`);
    expect(r.notices).toEqual([]);
  });

  it("a note cut inside a ZWJ sequence keeps it whole too", () => {
    const r = sectionFromPlaceholder("warmup_placeholder", `${"y".repeat(1997)}👩‍💻`);
    expect(r.note).toBe("y".repeat(1997));
  });
});

describe("Minor 211 — a lone CR ends a line", () => {
  it("names the section by the text before it", () =>
    expect(sectionFromPlaceholder("workout_placeholder", "EMOM 12\revery minute")).toEqual({ name: "EMOM 12", note: "every minute", notices: [] }));
  it("CRLF still reads as one line end", () =>
    expect(sectionFromPlaceholder("workout_placeholder", "A\r\n\r\nB")).toEqual({ name: "A", note: "B", notices: [] }));
});
