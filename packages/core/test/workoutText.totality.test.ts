import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findViolations } from "../scripts/purity-check.mjs";
import { RoutineWriteSchema } from "../src/dto/routine.js";
import { guessModality, matchExerciseName } from "../src/exerciseMatch.js";
import { buildImportPlan } from "../src/importPlan.js";
import { readWorkoutText } from "../src/workoutText.js";
import { prng } from "./helpers/history-generator.js";
import { toWrite } from "./helpers/importPlan.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-19.txt");
const FIXTURE_24 = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-24.txt");
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

function assertConserved(raw: string) {
  const r = readWorkoutText(raw);
  const { input, furniture, overlap, placed } = r.lines;
  expect(furniture + overlap + placed.length).toBe(input);
  const notes = [r.notes, ...r.sections.map((s) => s.notes)].join("\n").split("\n");
  for (const p of placed) if (p.as === "note") expect(notes).toContain(p.text);
}

describe("10.4 AC12 — every line ends up in exactly one place", () => {
  const raw = readFileSync(FIXTURE, "utf8");
  it("the example", () => {
    assertConserved(raw);
    const count = (as: string) => readWorkoutText(raw).lines.placed.filter((p) => p.as === as).length;
    expect([count("heading"), count("set-line"), count("scheme"), count("lead-in"), count("separator"), count("movement"), count("note")]).toEqual([4, 6, 2, 1, 1, 7, 33]);
  });
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seeded shuffle %i", (seed) => {
    const lines = raw.split("\n");
    const rnd = prng(seed);
    for (let i = lines.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [lines[i], lines[j]] = [lines[j]!, lines[i]!];
    }
    assertConserved(lines.join("\n"));
  });
});

describe("10.4 AC12 / AC53 — the 2026-10-24 paste: every line in exactly one place", () => {
  const raw = readFileSync(FIXTURE_24, "utf8");
  it("the paste", () => assertConserved(raw));
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seeded shuffle %i", (seed) => {
    const lines = raw.split("\n");
    const rnd = prng(seed);
    for (let i = lines.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [lines[i], lines[j]] = [lines[j]!, lines[i]!];
    }
    assertConserved(lines.join("\n"));
  });
});

const ALL = (raw: string) => {
  const r = readWorkoutText(raw);
  buildImportPlan(r, (k) => guessModality(k));
  r.names.forEach((n) => matchExerciseName(n.written, [{ id: "1", name: n.written, ownerUserId: null }]));
  return r;
};

describe("10.4 AC1 — total, linear, pure", () => {
  it.each([
    ["empty", ""], ["only furniture", "11:41\nHome\nNO SCORE\nRESULTS (3)"], ["unpaired surrogates", "\ud800 Squat\n- 5 \udfff Curl\nStrength\nx."],
    ["40,000-char line", "a".repeat(40_000)], ["40,000-digit line", "9".repeat(40_000)], ["40,000-char scheme", "1-".repeat(19_999) + "1"],
    ["5,000 lines", Array.from({ length: 5_000 }, (_, k) => (k % 7 === 0 ? "11:41" : `- ${(k % 90) + 1} Move ${k}x`)).join("\n")],
    ["5,000 identical lines over two chunks", "11:41\n" + "Same line here\n".repeat(2_500) + "11:42\n" + "Same line here\n".repeat(2_500)],
    ["control characters", "Push\u0000Press\u001f\n\u007fStrength\nx."],
    ["absurd counts", "Strength\n1000 Sets:\nSet 1: 500 Reps\n150-100-50\nRow\nx."],
  ])("%s finishes under 1 s without throwing, and the plan parses", (_, raw) => {
    const t0 = performance.now();
    const r = ALL(raw);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(RoutineWriteSchema.safeParse(toWrite(buildImportPlan(r, () => "weight_reps"))).success).toBe(true);
  });
  it("random strings never throw, and their plans parse", () => {
    const rnd = prng(7);
    for (let n = 0; n < 300; n++) {
      const r = ALL(Array.from({ length: 200 }, () => String.fromCharCode(Math.floor(rnd() * 0x10000))).join(""));
      expect(RoutineWriteSchema.safeParse(toWrite(buildImportPlan(r, () => "weight_reps"))).success).toBe(true);
    }
  });
  it("the three modules import only core siblings and carry no `message:`", () => {
    for (const f of ["workoutText.ts", "exerciseMatch.ts", "importPlan.ts"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src, f).not.toMatch(/\bmessage\s*:/);
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) expect(m[1], f).toMatch(/^\.\.?\//);
    }
    expect(findViolations(SRC)).toEqual([]);
  });
});

/** The order the import plan relies on, now that it no longer sorts (minor 22). */
function assertReaderOrder(raw: string) {
  const items = readWorkoutText(raw).items;
  // Loose items first, then section by section: the section index never goes down.
  const order = items.map((it) => it.section ?? -1);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // A run's members are consecutive, so runs come out in first appearance and so do their chunks of 8.
  const seen = new Set<number>();
  items.forEach((it, i) => {
    if (it.run === null) return;
    if (seen.has(it.run)) expect(items[i - 1]?.run, `run ${it.run} is split`).toBe(it.run);
    seen.add(it.run);
  });
}

describe("Minor 22 — the reader emits items section-ordered and runs whole", () => {
  const FIXTURE_26 = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-26.txt");
  it.each([FIXTURE, FIXTURE_24, FIXTURE_26])("%s and 100 seeded shuffles", (path) => {
    const raw = readFileSync(path, "utf8");
    assertReaderOrder(raw);
    for (let seed = 1; seed <= 100; seed++) {
      const lines = raw.split("\n");
      const rnd = prng(seed);
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [lines[i], lines[j]] = [lines[j]!, lines[i]!];
      }
      assertReaderOrder(lines.join("\n"));
    }
  });
  it("random strings", () => {
    const rnd = prng(11);
    for (let n = 0; n < 200; n++) {
      const words = ["Strength", "3 Sets:", "21-15-9", "- 10 Curl", "10 Row", "Max Cal Bike", "Engine", "then", "Set 1: 5 reps", "into:", "x."];
      assertReaderOrder(Array.from({ length: 30 }, () => words[Math.floor(rnd() * words.length)]!).join("\n"));
    }
  });
});
