import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { describe, expect, it } from "vitest";
import { RoutineLimitError, RoutineNameTakenError } from "../../src/errors/app-error.js";
import { FakeExerciseRepository, FakeRoutineRepository, makeExerciseRecord } from "../helpers/fakes.js";

/** The real create sweeps inside its transaction, so a refused create rolls the sweep back; the fake must too. */
function setup() {
  const exercises = new FakeExerciseRepository();
  const exercise = makeExerciseRecord({ isActive: true });
  exercises.byId.set(exercise.id, exercise);
  const routines = new FakeRoutineRepository(exercises);
  const user = uuidv7();
  const fields = (name: string, oneOff = false) => ({
    name,
    items: [{ exerciseId: exercise.id }],
    ...(oneOff ? { oneOff: true as const } : {}),
  });
  /** An expired one-off, aged through the fake's own map. */
  async function expiredOneOff(): Promise<string> {
    const { routine } = await routines.create(user, fields(`Class ${uuidv7()}`, true));
    routines.routines.set(routine.id, { ...routine, oneOffUntil: new Date(Date.now() - 60_000) });
    return routine.id;
  }
  return { routines, user, fields, expiredOneOff };
}

describe("Minors 40, 227 — a refused create keeps the expired one-offs (its sweep rolls back)", () => {
  it("a name clash", async () => {
    const { routines, user, fields, expiredOneOff } = setup();
    await routines.create(user, fields("Push"));
    const expired = await expiredOneOff();
    await expect(routines.create(user, fields("Push"))).rejects.toBeInstanceOf(RoutineNameTakenError);
    expect(routines.routines.has(expired)).toBe(true);
  });

  it("the routine cap", async () => {
    const { routines, user, fields } = setup();
    for (let i = 0; i < ROUTINES_PER_USER_MAX; i += 1) await routines.create(user, fields(`R${i}`));
    // An expired one-off added after those creates, so only the refused create's sweep could remove it.
    const any = routines.routines.values().next().value!;
    const expired = uuidv7();
    routines.routines.set(expired, { ...any, id: expired, name: "Old class", oneOffUntil: new Date(Date.now() - 60_000) });
    await expect(routines.create(user, fields("One too many"))).rejects.toBeInstanceOf(RoutineLimitError);
    expect(routines.routines.has(expired)).toBe(true);
  });

  it("a successful create still sweeps", async () => {
    const { routines, user, fields, expiredOneOff } = setup();
    const expired = await expiredOneOff();
    const { swept } = await routines.create(user, fields("Pull"));
    expect(swept).toBe(1);
    expect(routines.routines.has(expired)).toBe(false);
  });
});

describe("Minor 229 — a live-routine provider can unregister", () => {
  it("an unregistered provider no longer holds a routine from the sweep", async () => {
    const { routines, user, fields, expiredOneOff } = setup();
    const expired = await expiredOneOff();
    const unregister = routines.addLiveRoutineProvider(() => new Set([expired]));
    unregister();
    const { swept } = await routines.create(user, fields("Legs"));
    expect(swept).toBe(1);
  });

  it("a registered one still holds it", async () => {
    const { routines, user, fields, expiredOneOff } = setup();
    const expired = await expiredOneOff();
    routines.addLiveRoutineProvider(() => new Set([expired]));
    const { swept } = await routines.create(user, fields("Arms"));
    expect(swept).toBe(0);
  });
});
