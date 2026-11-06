import { describe, expect, it } from "vitest";
import { createRng } from "../src/plan/rng.ts";
import { seededRoutineSets } from "../src/plan/routine.ts";
import {
  OPEN_APP_READS,
  buildSession,
  joinAt,
  joinedActions,
  nextActionOnStartConflict,
  restSeconds,
  type Action,
} from "../src/plan/session.ts";

const SETS = seededRoutineSets();
const kinds = (actions: Action[]) => actions.map((a) => a.kind);

describe("AC2 — a simulated session is a real session", () => {
  it("open-app reads, start, set then rest for each set (no rest after the last), finish, history, progress", () => {
    const { actions } = buildSession({ seed: 1, sets: [2, 1], pushFactor: 1 });
    expect(actions.slice(0, OPEN_APP_READS.length)).toEqual(OPEN_APP_READS.map((name) => ({ kind: "read", name })));
    expect(kinds(actions.slice(OPEN_APP_READS.length))).toEqual([
      "start",
      "set",
      "rest",
      "set",
      "rest",
      "set",
      "finish",
      "history",
      "progress",
    ]);
    const sets = actions.filter((a) => a.kind === "set");
    expect(sets).toEqual([
      { kind: "set", itemIndex: 0, setIndex: 0 },
      { kind: "set", itemIndex: 0, setIndex: 1 },
      { kind: "set", itemIndex: 1, setIndex: 0 },
    ]);
  });

  it("the same seed gives the same plan; different seeds differ in their rests", () => {
    expect(buildSession({ seed: 5, sets: SETS, pushFactor: 1 })).toEqual(buildSession({ seed: 5, sets: SETS, pushFactor: 1 }));
    const rests = (seed: number) =>
      buildSession({ seed, sets: SETS, pushFactor: 1 }).actions.flatMap((a) => (a.kind === "rest" ? [a.seconds] : []));
    expect(rests(1)).not.toEqual(rests(2));
  });
});

describe("AC3 — rests are at a real gym pace", () => {
  it("real pace: every rest is in [90, 180] s over 1,000 seeds", () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const r = restSeconds(createRng(seed), 1);
      expect(r).toBeGreaterThanOrEqual(90);
      expect(r).toBeLessThanOrEqual(180);
    }
  });

  it("push ×4: every rest is divided by 4 and the plan carries the factor", () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const r = restSeconds(createRng(seed), 4);
      expect(r).toBeGreaterThanOrEqual(22.5);
      expect(r).toBeLessThanOrEqual(45);
    }
    expect(buildSession({ seed: 1, sets: SETS, pushFactor: 4 }).pushFactor).toBe(4);
  });
});

describe("AC13 — every step carries the full mix", () => {
  it("500 lifters joining part-way together send set saves, finishes, History and Progress reads", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 500; seed += 1) {
      const { actions } = buildSession({ seed, sets: SETS, pushFactor: 1 });
      for (const a of joinedActions(actions, joinAt(actions, createRng(seed * 7919)))) seen.add(a.kind);
    }
    for (const kind of ["set", "finish", "history", "progress"]) expect(seen, kind).toContain(kind);
  });

  it("join points spread over the whole session", () => {
    const { actions } = buildSession({ seed: 1, sets: SETS, pushFactor: 1 });
    const starts = new Set(Array.from({ length: 2000 }, (_, i) => joinAt(actions, createRng(i + 1)).startIndex));
    expect(Math.min(...starts)).toBe(0);
    expect(Math.max(...starts)).toBe(actions.length - 1);
  });
});

describe("Review Focus 5 — a lifter that joins after its last set never finishes a workout it didn't start", () => {
  const { actions } = buildSession({ seed: 3, sets: SETS, pushFactor: 1 });
  const finishAt = actions.findIndex((a) => a.kind === "finish");

  it("joining at finish skips the finish and goes on to History and Progress", () => {
    const join = { startIndex: finishAt, needsStart: false };
    expect(joinAt(actions, () => (finishAt + 0.5) / actions.length)).toEqual(join);
    expect(kinds(joinedActions(actions, join))).toEqual(["history", "progress"]);
  });

  it("joining mid-workout sends start first, then continues from the join point", () => {
    const setAt = actions.findIndex((a) => a.kind === "set") + 4;
    const join = joinAt(actions, () => (setAt + 0.5) / actions.length);
    expect(join).toEqual({ startIndex: setAt, needsStart: true });
    const joined = joinedActions(actions, join);
    expect(joined[0]).toEqual({ kind: "start" });
    expect(joined.slice(1)).toEqual(actions.slice(setAt));
  });

  it("over every join point, no finish appears without a start before it", () => {
    for (let startIndex = 0; startIndex < actions.length; startIndex += 1) {
      const join = joinAt(actions, () => (startIndex + 0.5) / actions.length);
      const stream = joinedActions(actions, join);
      const finish = stream.findIndex((a) => a.kind === "finish");
      if (finish >= 0) expect(stream.slice(0, finish).some((a) => a.kind === "start"), `join at ${startIndex}`).toBe(true);
    }
  });
});

describe("Review Focus 1 — a leftover live workout", () => {
  it("409 on start adopts the active workout; anything else is a recorded failure", () => {
    expect(nextActionOnStartConflict(409)).toBe("adopt_active");
    expect(nextActionOnStartConflict(500)).toBe("record_failure");
    expect(nextActionOnStartConflict(422)).toBe("record_failure");
  });
});
