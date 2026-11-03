import { roundTimeIssues, type RoundTime, type SectionTimer, type TimerFormat } from "@sin/core";
import { describe, expect, it } from "vitest";
import { orderRoundWrites, type RoundWrite } from "./orderRoundWrites";

const rt = (pairs: [number, number][]): RoundTime[] => pairs.map(([round, seconds]) => ({ round, seconds }));
const w = (pairs: [number, number | null][]): RoundWrite[] => pairs.map(([round, seconds]) => ({ round, seconds }));

describe("10.7 AC32 — orderRoundWrites", () => {
  it.each<[string, TimerFormat, RoundTime[], RoundTime[], RoundWrite[]]>([
    ["an AMRAP shifted later goes highest round first", "amrap", rt([[1, 250], [2, 515], [3, 770]]), rt([[1, 280], [2, 545], [3, 800]]), w([[3, 800], [2, 545], [1, 280]])],
    ["an AMRAP shifted earlier goes lowest round first", "amrap", rt([[1, 250], [2, 515], [3, 770]]), rt([[1, 220], [2, 485], [3, 740]]), w([[1, 220], [2, 485], [3, 740]])],
    ["a clear, then a new round", "time_cap", rt([[1, 250], [2, 515]]), rt([[1, 250], [3, 770]]), w([[2, null], [3, 770]])],
    ["a Set Timer is ascending, clears included", "set_timer", rt([[1, 221], [2, 218]]), rt([[1, 200], [3, 210]]), w([[1, 200], [2, null], [3, 210]])],
    ["no change gives nothing", "amrap", rt([[1, 250], [2, 515]]), rt([[2, 515], [1, 250]]), []],
    ["clears ascending, then downs ascending, then ups descending", "amrap", rt([[1, 100], [2, 200], [3, 300], [4, 400], [5, 500]]), rt([[1, 90], [3, 280], [4, 450], [6, 600]]), w([[2, null], [5, null], [1, 90], [3, 280], [6, 600], [4, 450]])],
  ])("%s", (_name, format, existing, final, expected) => {
    expect(orderRoundWrites(format, existing, final)).toEqual(expected);
  });
});

/** A seeded PRNG (mulberry32), copied from `src/test/importFixtures.ts`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** Strictly increasing readings on a random subset of rounds 1–12, all within `cap`. */
function readings(rand: () => number, cap: number): RoundTime[] {
  const rounds = Array.from({ length: 12 }, (_, i) => i + 1).filter(() => rand() < 0.5);
  const values = new Set<number>();
  while (values.size < rounds.length) values.add(int(rand, 1, cap));
  const sorted = [...values].sort((a, b) => a - b);
  return rounds.map((round, i) => ({ round, seconds: sorted[i]! }));
}

/** Apply `writes` one at a time; every set must pass `roundTimeIssues` against the state so far. */
function replay(timer: SectionTimer, existing: readonly RoundTime[], writes: readonly RoundWrite[]): { state: RoundTime[]; issues: string[] } {
  let state = [...existing];
  const issues: string[] = [];
  for (const { round, seconds } of writes) {
    if (seconds === null) {
      state = state.filter((t) => t.round !== round);
      continue;
    }
    const found = roundTimeIssues(timer, state.filter((t) => t.round !== round), round, seconds);
    if (found.length > 0) issues.push(`${round}=${seconds}: ${found.map((i) => i.code).join(",")}`);
    state = [...state.filter((t) => t.round !== round), { round, seconds }];
  }
  return { state: state.sort((a, b) => a.round - b.round), issues };
}

describe("10.7 AC32 — property: every write is valid in turn", () => {
  it.each([1, 2, 3, 42, 2026])("AMRAP / Time Cap, seed %i, 400 cases", (seed) => {
    const rand = mulberry32(seed);
    for (let c = 0; c < 400; c += 1) {
      const kind = rand();
      const timer: SectionTimer =
        kind < 0.4 ? { format: "amrap", capSeconds: int(rand, 60, 10_800) } : kind < 0.8 ? { format: "time_cap", capSeconds: int(rand, 60, 10_800) } : { format: "time_cap", capSeconds: null };
      const cap = timer.capSeconds ?? 10_800;
      const existing = readings(rand, cap);
      const final = readings(rand, cap);
      const { state, issues } = replay(timer, existing, orderRoundWrites(timer.format, existing, final));
      expect(issues, JSON.stringify({ timer, existing, final })).toEqual([]);
      expect(state).toEqual([...final].sort((a, b) => a.round - b.round));
    }
  });

  it.each([1, 2, 3, 42, 2026])("Set Timer, seed %i, 400 cases", (seed) => {
    const rand = mulberry32(seed);
    for (let c = 0; c < 400; c += 1) {
      const timer: SectionTimer = { format: "set_timer", rounds: int(rand, 1, 12), roundSeconds: int(rand, 10, 3600) };
      const pick = () =>
        Array.from({ length: timer.rounds }, (_, i) => i + 1)
          .filter(() => rand() < 0.6)
          .map((round) => ({ round, seconds: int(rand, 1, timer.roundSeconds) }));
      const existing = pick();
      const final = pick();
      const { state, issues } = replay(timer, existing, orderRoundWrites(timer.format, existing, final));
      expect(issues).toEqual([]);
      expect(state).toEqual(final);
    }
  });
});
