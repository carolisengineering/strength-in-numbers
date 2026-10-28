import { SECTION_DEFAULT_RULES, sectionKey } from "./sections.js";
import type { HevyMapping, HevyPair } from "./types.js";
import { MEASURE_RULE_VALUES, SECTION_TREATMENT_VALUES, type MeasureRule, type SectionTreatment } from "./vocabulary.js";

/** Spec 19.0 AC14: the mapping file's header row. */
export const MAPPING_CSV_HEADER = "kind,hevy_id,hevy_title,sin_id,sin_name,rule,export_as";
/** A file over 1 MiB (as UTF-8) or 5,000 lines is refused before parsing. */
export const MAPPING_CSV_MAX_BYTES = 1_048_576;
export const MAPPING_CSV_MAX_LINES = 5000;

/** Error codes: never the cell's text (#57). */
export const MAPPING_CSV_ERROR_CODES = Object.freeze([
  "bad_header",
  "unknown_kind",
  "missing_column",
  "bad_rule",
  "bad_export_as",
  "no_hevy_ref",
  "no_sin_ref",
  "too_many_lines",
  "file_too_large",
] as const);
export type MappingCsvErrorCode = (typeof MAPPING_CSV_ERROR_CODES)[number];

export type MappingCsvKind = "exercise" | "skip" | "placeholder" | "section";
const KINDS: readonly MappingCsvKind[] = ["exercise", "skip", "placeholder", "section"];

/** One line of the file, as written: a hand-written line may carry a title and no id, a name and no SIN id. */
export interface MappingCsvLine {
  kind: MappingCsvKind;
  hevyId: string | null;
  hevyTitle: string | null;
  sinId: string | null;
  sinName: string | null;
  rule: MeasureRule | "warmup" | "workout" | SectionTreatment | null;
  exportAs: boolean | null;
}

export interface MappingCsvError {
  line: number;
  code: MappingCsvErrorCode;
}

/** The UTF-8 size of a string, without `TextEncoder` (core has no DOM lib). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const lower = (s: string | null) => (s ?? "").toLowerCase();
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The canonical order (AC14): grouped by kind; by lowercase title then id; section lines by name key. */
function compareLines(a: MappingCsvLine, b: MappingCsvLine): number {
  const kind = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  if (kind !== 0) return kind;
  if (a.kind === "section") return byCodeUnit(sectionKey(a.sinName ?? ""), sectionKey(b.sinName ?? ""));
  return byCodeUnit(lower(a.hevyTitle), lower(b.hevyTitle)) || byCodeUnit(a.hevyId ?? "", b.hevyId ?? "");
}

function cell(value: string | null): string {
  if (value === null) return "";
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Minor 189: a spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` (or a tab or CR) as a formula, so a text
 * cell that starts with one, or with the escape itself, is written with one `'` in front; the parse drops one leading
 * `'` from a text cell, so every cell reads back as it was (AC14) and a hand-written `'Bench` reads as `Bench`.
 */
function guarded(value: string | null): string | null {
  return value !== null && /^[=+\-@\t\r']/.test(value) ? `'${value}` : value;
}

const unguarded = (value: string): string => (value.startsWith("'") ? value.slice(1) : value);

const trimmed = (v: string | null) => (v === null ? null : v.trim());
/** Cells trimmed as the parse trims them, before sorting, so a second pass reads and orders the same (minor 134). */
const trimLine = (l: MappingCsvLine): MappingCsvLine => ({ ...l, hevyId: trimmed(l.hevyId), hevyTitle: trimmed(l.hevyTitle), sinId: trimmed(l.sinId), sinName: trimmed(l.sinName) });

/** Spec 19.0 AC14: RFC 4180, CRLF line ends, UTF-8 without a BOM, in the canonical order. */
export function formatMappingCsv(lines: readonly MappingCsvLine[]): string {
  const rows = lines.map(trimLine).sort(compareLines).map((l) =>
    [l.kind, guarded(l.hevyId), guarded(l.hevyTitle), guarded(l.sinId), guarded(l.sinName), l.rule, l.kind === "exercise" && l.exportAs !== null ? (l.exportAs ? "yes" : "no") : null]
      .map(cell)
      .join(","),
  );
  return [MAPPING_CSV_HEADER, ...rows].map((row) => `${row}\r\n`).join("");
}

/**
 * RFC 4180 records with the 1-based physical line each starts on. Quoted cells may hold commas, quotes and line ends.
 * A line ends in `\r\n`, `\n` or a lone `\r` (Excel's "CSV (Macintosh)").
 */
function records(text: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
        value += c;
      }
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(value);
      value = "";
    } else if (c === "\r" && text[i + 1] === "\n") continue;
    else if (c === "\n" || c === "\r") {
      cells.push(value);
      out.push({ line: start, cells });
      cells = [];
      value = "";
      line++;
      start = line;
    } else value += c;
  }
  if (value !== "" || cells.length > 0) {
    cells.push(value);
    out.push({ line: start, cells });
  }
  return out;
}

const RULES_FOR: Readonly<Record<MappingCsvKind, readonly string[]>> = {
  exercise: MEASURE_RULE_VALUES,
  skip: [],
  placeholder: ["warmup", "workout"],
  section: SECTION_TREATMENT_VALUES,
};

/**
 * Spec 19.0 AC14: the file back into lines. Accepts a leading BOM, `\n`, `\r\n` or `\r`, and blank lines (skipped). Each
 * error carries its 1-based line and a code, never the cell's text; a bad header stops the parse. `lineNumbers[i]` is
 * the 1-based line `lines[i]` starts on (Spec 20.0 AC19 names a left-out line by its number).
 */
export function parseMappingCsv(text: string): { lines: MappingCsvLine[]; lineNumbers: number[]; errors: MappingCsvError[] } {
  // UTF-8 never takes fewer bytes than UTF-16 units, so an over-long string is refused without the walk (minor 138).
  if (text.length > MAPPING_CSV_MAX_BYTES || utf8Length(text) > MAPPING_CSV_MAX_BYTES) {
    return { lines: [], lineNumbers: [], errors: [{ line: 1, code: "file_too_large" }] };
  }
  const body = text.replace(/^\uFEFF/, "");
  const physical = body.replace(/(\r\n|\r|\n)+$/, "").split(/\r\n|\r|\n/).length;
  if (physical > MAPPING_CSV_MAX_LINES) {
    return { lines: [], lineNumbers: [], errors: [{ line: MAPPING_CSV_MAX_LINES + 1, code: "too_many_lines" }] };
  }

  const rows = records(body).filter((r) => r.cells.some((c) => c.trim() !== ""));
  const [header, ...rest] = rows;
  if (!header || header.cells.map((c) => c.trim()).join(",") !== MAPPING_CSV_HEADER) {
    return { lines: [], lineNumbers: [], errors: [{ line: header?.line ?? 1, code: "bad_header" }] };
  }

  const lines: MappingCsvLine[] = [];
  const lineNumbers: number[] = [];
  const errors: MappingCsvError[] = [];
  for (const { line, cells } of rest) {
    const fail = (code: MappingCsvErrorCode) => errors.push({ line, code });
    if (cells.length !== 7) {
      fail("missing_column");
      continue;
    }
    const [kind, rawHevyId, rawHevyTitle, rawSinId, rawSinName, rule, exportAs] = cells.map((c) => c.trim());
    const [hevyId, hevyTitle, sinId, sinName] = [rawHevyId!, rawHevyTitle!, rawSinId!, rawSinName!].map(unguarded);
    const orNull = (v: string | undefined) => (v === undefined || v === "" ? null : v);
    if (!KINDS.includes(kind as MappingCsvKind)) {
      fail("unknown_kind");
      continue;
    }
    const k = kind as MappingCsvKind;
    const allowed = RULES_FOR[k];
    const needsRule = k === "placeholder" || k === "section";
    if ((rule === "" && needsRule) || (rule !== "" && !allowed.includes(rule!))) {
      fail("bad_rule");
      continue;
    }
    if (exportAs !== "" && exportAs !== "yes" && exportAs !== "no") {
      fail("bad_export_as");
      continue;
    }
    if (k !== "section" && hevyId === "" && hevyTitle === "") {
      fail("no_hevy_ref");
      continue;
    }
    if ((k === "exercise" && sinId === "" && sinName === "") || (k === "section" && sinName === "")) {
      fail("no_sin_ref");
      continue;
    }
    lines.push({
      kind: k,
      hevyId: orNull(hevyId),
      hevyTitle: orNull(hevyTitle),
      sinId: orNull(sinId),
      sinName: orNull(sinName),
      rule: orNull(rule) as MappingCsvLine["rule"],
      exportAs: exportAs === "" ? null : exportAs === "yes",
    });
    lineNumbers.push(line);
  }
  return { lines, lineNumbers, errors };
}

const PLACEHOLDER_RULE: Readonly<Partial<Record<HevyPair["role"], "warmup" | "workout">>> = {
  warmup_placeholder: "warmup",
  workout_placeholder: "workout",
};

/**
 * Spec 19.0 AC14: a stored mapping as file lines, with the effective section rules (the defaults under the user's,
 * by name key). The SIN name needs a catalog lookup the mapping does not carry, so the caller passes `sinNameOf`.
 */
export function mappingToCsvLines(mapping: HevyMapping, sinNameOf: (exerciseId: string) => string | null): MappingCsvLine[] {
  const pairs: MappingCsvLine[] = mapping.pairs.map((p) => {
    const base = { hevyId: p.hevyTemplateId, hevyTitle: p.hevyTitle, sinId: null, sinName: null, rule: null, exportAs: null };
    if (p.role === "exercise") {
      return { ...base, kind: "exercise", sinId: p.exerciseId, sinName: p.exerciseId === null ? null : sinNameOf(p.exerciseId), rule: p.measureRule, exportAs: p.exportAs };
    }
    if (p.role === "skip") return { ...base, kind: "skip" };
    return { ...base, kind: "placeholder", rule: PLACEHOLDER_RULE[p.role]! };
  });
  const effective = new Map(SECTION_DEFAULT_RULES.map((r) => [sectionKey(r.name), r]));
  for (const r of mapping.sectionRules) effective.set(sectionKey(r.name), r);
  const sections: MappingCsvLine[] = [...effective.values()].map((r) => ({
    kind: "section",
    hevyId: null,
    hevyTitle: null,
    sinId: null,
    sinName: r.name,
    rule: r.treatment,
    exportAs: null,
  }));
  return [...pairs, ...sections].sort(compareLines);
}
