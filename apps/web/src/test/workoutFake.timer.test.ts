import { RoutineSectionSchema, type Routine, type SectionTimer } from "@sin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { draftFromRoutine } from "../features/routines/routineDraft";
import { toRoutineInput } from "../features/routines/validateDraft";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { createWorkoutFake } from "./workoutFake";
import { sectioned } from "./sectionedDraft";
import { pushA, pushSectioned } from "./routineFixtures";

beforeEach(() => stubWebEnv());
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

async function put(id: string, body: unknown): Promise<Routine> {
  const res = await fetch(`${API_BASE_URL}/v1/routines/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  return (await res.json()) as Routine;
}

describe("10.7 AC14 — round trip and rollout", () => {
  it.each<SectionTimer>([
    { format: "set_timer", roundSeconds: 300, rounds: 5 },
    { format: "amrap", capSeconds: 720 },
    { format: "time_cap", capSeconds: 900 },
    { format: "time_cap", capSeconds: null },
  ])("the fake echoes %j, and a reload gives the same timer", async (timer) => {
    const fake = createWorkoutFake({ routines: [pushA], catalog: [makeExercise({ id: exerciseId(1), name: "Bench" })] });
    server.use(...fake.handlers);
    const d = sectioned("", ["M", "a"]);
    const draft = { ...d, items: d.items.map((i) => ({ ...i, exerciseId: exerciseId(1) })), sections: d.sections.map((s) => ({ ...s, timer })) };
    const saved = await put(pushA.id, toRoutineInput(draft, { modalityOf: () => null }));
    expect(saved.sections[0]!.timer).toEqual(timer);
    expect(draftFromRoutine(saved).sections[0]!.timer).toEqual(timer);
  });

  it("the routine section response requires timer", () => {
    const noTimer = Object.fromEntries(Object.entries(pushSectioned.sections[0]!).filter(([key]) => key !== "timer"));
    expect(RoutineSectionSchema.safeParse(noTimer).success).toBe(false);
  });

  it("the fixtures carry timer: null", () => {
    expect(pushSectioned.sections.map((s) => s.timer)).toEqual([null, null]);
  });
});

describe("10.7 AC14 — no default on timer", () => {
  it("features/routines never defaults or catches timer", () => {
    const sources = import.meta.glob(["../features/routines/**/*.ts", "../features/routines/**/*.tsx", "!../features/routines/**/*.test.*"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(sources).filter(([, src]) => /timer[^\n]*\.(default|catch)\(/.test(src));
    expect(offenders.map(([p]) => p)).toEqual([]);
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });
});
