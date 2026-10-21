import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readWorkoutText } from "../src/workoutText.js";
import { prng } from "./helpers/history-generator.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/hiraya-2026-10-19.txt");

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
