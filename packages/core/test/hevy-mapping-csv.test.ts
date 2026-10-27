import { describe, expect, it } from "vitest";
import {
  MAPPING_CSV_ERROR_CODES,
  MAPPING_CSV_HEADER,
  MAPPING_CSV_MAX_BYTES,
  MAPPING_CSV_MAX_LINES,
  formatMappingCsv,
  mappingToCsvLines,
  parseMappingCsv,
  type MappingCsvLine,
} from "../src/index.js";

const line = (o: Partial<MappingCsvLine> & Pick<MappingCsvLine, "kind">): MappingCsvLine => ({
  hevyId: null,
  hevyTitle: null,
  sinId: null,
  sinName: null,
  rule: null,
  exportAs: null,
  ...o,
});

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

// Canonical order: exercise, skip, placeholder, section; by lowercase title then id; sections by name key.
const LISTS: MappingCsvLine[][] = [
  [
    line({ kind: "exercise", hevyId: "05293BCA", hevyTitle: "Bench Press (Barbell)", sinId: ID_A, sinName: "Bench Press", exportAs: true }),
    line({ kind: "exercise", hevyId: "C1", hevyTitle: "Curl, \"Hammer\"", sinId: ID_B, sinName: "Hammer curl", exportAs: false }),
    line({ kind: "exercise", hevyId: "R1", hevyTitle: "Rower (calories)", sinId: ID_B, sinName: "Echo Bike", rule: "calories_as_reps", exportAs: true }),
    line({ kind: "skip", hevyId: "S1", hevyTitle: "Stretching" }),
    line({ kind: "placeholder", hevyId: "W1", hevyTitle: "Warmup", rule: "warmup" }),
    line({ kind: "placeholder", hevyId: "W2", hevyTitle: "Workout", rule: "workout" }),
    line({ kind: "section", sinName: "Accessory", rule: "notes_on_first" }),
    line({ kind: "section", sinName: "Warm-up", rule: "warmup_placeholder" }),
  ],
  [line({ kind: "exercise", hevyTitle: "Hand-written, no id", sinName: "Squat", exportAs: null })],
  [line({ kind: "section", sinName: "Finisher\nfast", rule: "workout_placeholder" })],
];

describe("19.0 AC14 — format", () => {
  const text = formatMappingCsv(LISTS[0]!);
  const rows = text.split("\r\n");

  it("the header comes first; lines end in CRLF; no BOM", () => {
    expect(rows[0]).toBe(MAPPING_CSV_HEADER);
    expect(MAPPING_CSV_HEADER).toBe("kind,hevy_id,hevy_title,sin_id,sin_name,rule,export_as");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n](?![^"]*")/);
  });

  it("exportAs is yes / no, and empty for the other kinds", () => {
    expect(rows[1]!.endsWith(",yes")).toBe(true);
    expect(rows[2]!.endsWith(",no")).toBe(true);
    expect(rows[4]).toBe("skip,S1,Stretching,,,,");
  });

  it("a placeholder's rule is warmup / workout; a section line carries its name and treatment", () => {
    expect(rows[5]).toBe("placeholder,W1,Warmup,,,warmup,");
    expect(rows[7]).toBe("section,,,,Accessory,notes_on_first,");
  });

  it("quotes a comma, a quote, CR and LF", () => {
    expect(rows[2]).toContain('"Curl, ""Hammer"""');
    expect(formatMappingCsv(LISTS[2]!)).toContain('"Finisher\nfast"');
    expect(formatMappingCsv([line({ kind: "section", sinName: "a\rb", rule: "notes_on_first" })])).toContain('"a\rb"');
  });

  it("sorts into the canonical order whatever the input order", () => {
    expect(formatMappingCsv([...LISTS[0]!].reverse())).toBe(text);
  });
});

describe("19.0 AC14 — round trip", () => {
  it.each(LISTS.map((l, i) => [i, l] as const))("list %i: parse(format(m)) is m, and format is stable", (_i, m) => {
    const parsed = parseMappingCsv(formatMappingCsv(m));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toEqual(m);
    expect(formatMappingCsv(parsed.lines)).toBe(formatMappingCsv(m));
  });
});

describe("19.0 AC14 — tolerant input (Review Focus 4)", () => {
  const clean = formatMappingCsv(LISTS[0]!);
  it.each([
    ["a BOM", `\uFEFF${clean}`],
    ["LF line ends", clean.replace(/\r\n/g, "\n")],
    ["a trailing blank line", `${clean}\r\n`],
    ["no final line end", clean.slice(0, -2)],
  ])("%s parses the same", (_l, text) => {
    const parsed = parseMappingCsv(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toEqual(LISTS[0]);
  });
});

describe("19.0 AC14 — errors", () => {
  const body = (...rows: string[]) => [MAPPING_CSV_HEADER, ...rows].join("\r\n");

  it("lists the nine codes", () => {
    expect(MAPPING_CSV_ERROR_CODES).toEqual([
      "bad_header",
      "unknown_kind",
      "missing_column",
      "bad_rule",
      "bad_export_as",
      "no_hevy_ref",
      "no_sin_ref",
      "too_many_lines",
      "file_too_large",
    ]);
  });

  it.each([
    ["bad_header", "kind,hevy_id\r\nexercise,X", 1],
    ["unknown_kind", body("superset,X,Secret Title,,Squat,,yes"), 2],
    ["missing_column", body("exercise,X,Secret Title,,Squat,"), 2],
    ["bad_rule", body("exercise,X,Secret Title,,Squat,warmup,yes"), 2],
    ["bad_export_as", body("exercise,X,Secret Title,,Squat,,maybe"), 2],
    ["no_hevy_ref", body("exercise,,,,Squat,,yes"), 2],
    ["no_sin_ref", body("skip,S,Stretching,,,,", "exercise,X,Secret Title,,,,yes"), 3],
    ["no_sin_ref", body("section,,,,,notes_on_first,"), 2],
  ] as const)("%s, with its 1-based line", (code, text, lineNo) => {
    const parsed = parseMappingCsv(text);
    expect(parsed.errors).toEqual([{ line: lineNo, code }]);
    expect(JSON.stringify(parsed.errors)).not.toContain("Secret Title");
  });

  it("a placeholder needs warmup or workout; a skip takes no rule", () => {
    expect(parseMappingCsv(body("placeholder,P,Marker,,,calories_as_reps,")).errors).toEqual([{ line: 2, code: "bad_rule" }]);
    expect(parseMappingCsv(body("skip,S,Stretching,,,warmup,")).errors).toEqual([{ line: 2, code: "bad_rule" }]);
  });

  it("too_many_lines: 5,001 lines are refused before parsing", () => {
    const text = body(...Array.from({ length: MAPPING_CSV_MAX_LINES }, (_, i) => `skip,S${i},Stretching,,,,`));
    expect(MAPPING_CSV_MAX_LINES).toBe(5000);
    expect(parseMappingCsv(text)).toEqual({ lines: [], errors: [{ line: MAPPING_CSV_MAX_LINES + 1, code: "too_many_lines" }] });
  });

  it("file_too_large: 1 MiB + 1 byte is refused before parsing", () => {
    expect(MAPPING_CSV_MAX_BYTES).toBe(1_048_576);
    const text = MAPPING_CSV_HEADER + "\r\n" + "x".repeat(MAPPING_CSV_MAX_BYTES + 1 - MAPPING_CSV_HEADER.length - 2);
    expect(Buffer.byteLength(text, "utf8")).toBe(MAPPING_CSV_MAX_BYTES + 1);
    expect(parseMappingCsv(text)).toEqual({ lines: [], errors: [{ line: 1, code: "file_too_large" }] });
  });
});

describe("19.0 AC14 — mappingToCsvLines", () => {
  it("writes pairs and the effective section rules (defaults under the user's)", () => {
    const lines = mappingToCsvLines(
      {
        pairs: [
          { hevyTemplateId: "S1", hevyTitle: "Stretching", hevyType: "duration", role: "skip", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false },
          { hevyTemplateId: "B1", hevyTitle: "Bench", hevyType: "weight_reps", role: "exercise", exerciseId: ID_A, exerciseActive: true, measureRule: null, exportAs: true },
          { hevyTemplateId: "W1", hevyTitle: "Warmup", hevyType: "reps_only", role: "warmup_placeholder", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false },
        ],
        sectionRules: [{ name: "accessory", treatment: "workout_placeholder" }, { name: "Finisher", treatment: "notes_on_first" }],
      },
      (id) => (id === ID_A ? "Bench Press" : null),
    );
    expect(lines).toEqual([
      line({ kind: "exercise", hevyId: "B1", hevyTitle: "Bench", sinId: ID_A, sinName: "Bench Press", exportAs: true }),
      line({ kind: "skip", hevyId: "S1", hevyTitle: "Stretching" }),
      line({ kind: "placeholder", hevyId: "W1", hevyTitle: "Warmup", rule: "warmup" }),
      line({ kind: "section", sinName: "accessory", rule: "workout_placeholder" }),
      line({ kind: "section", sinName: "Finisher", rule: "notes_on_first" }),
      line({ kind: "section", sinName: "Warm-up", rule: "warmup_placeholder" }),
    ]);
  });
});
