import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { ExerciseRecord } from "../../src/repositories/exercise.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeUserRepository, makeUser } from "../helpers/fakes.js";

const JSON_HEADERS = { authorization: "Bearer test-token", "content-type": "application/json" };
const OWN = "018f9c8e-0000-7000-8000-000000000011";
const BUILT_IN = "018f9c8e-0000-7000-8000-000000000012";

const row = (o: Partial<ExerciseRecord>): ExerciseRecord => ({
  id: OWN,
  catalogKey: null,
  ownerUserId: null,
  name: "Secret Lift Name",
  modality: "weight_reps",
  primaryMuscleId: null,
  secondaryMuscleIds: [],
  equipmentId: null,
  isActive: true,
  forkedFromExerciseId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...o,
});

async function setup(locked: boolean) {
  const lines: string[] = [];
  const exerciseRepo = new FakeExerciseRepository();
  const userRepo = new FakeUserRepository();
  const user = makeUser({ authSub: "auth0|user-123" });
  userRepo.seed(user);
  exerciseRepo.hasSets = () => locked;
  exerciseRepo.byId.set(OWN, row({ id: OWN, ownerUserId: user.id }));
  exerciseRepo.byId.set(BUILT_IN, row({ id: BUILT_IN, ownerUserId: null }));
  const { app } = await buildTestApp({
    exerciseRepository: exerciseRepo,
    userRepository: userRepo,
    logger: pino({ level: "info" }, { write: (s: string) => lines.push(s) }),
  });
  const logged = (msg: string) => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === msg);
  return { app, user, lines, logged };
}
/** pino's own keys and the request bindings; everything else on the line is ours. */
const PINO_KEYS = new Set(["level", "time", "pid", "hostname", "msg", "reqId", "req_id", "request_id", "trace_id", "span_id", "client_ip", "user_id"]);
const ownKeys = (line: Record<string, unknown>) => Object.keys(line).filter((k) => !PINO_KEYS.has(k)).sort();

describe("03.4 AC20 — logging", () => {
  it("custom_exercise_updated carries modality_changed: true for a type change, false for a name change", async () => {
    const { app, logged } = await setup(false);
    expect((await app.inject({ method: "PATCH", url: `/v1/exercises/${OWN}`, headers: JSON_HEADERS, payload: { modality: "calories" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/v1/exercises/${OWN}`, headers: JSON_HEADERS, payload: { name: "Renamed" } })).statusCode).toBe(200);
    expect(logged("custom_exercise_updated").map((l) => l.modality_changed)).toEqual([true, false]);
  });

  it("Review Focus 4 — a refused PATCH logs the refusal once, with enum values only", async () => {
    const { app, user, lines, logged } = await setup(true);
    const res = await app.inject({ method: "PATCH", url: `/v1/exercises/${OWN}`, headers: JSON_HEADERS, payload: { modality: "duration" } });
    expect(res.statusCode).toBe(409);
    const refused = logged("custom_exercise_type_change_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ exercise_id: OWN, owner_user_id: user.id, from_modality: "weight_reps", to_modality: "duration" });
    expect(ownKeys(refused[0]!)).toEqual(["exercise_id", "from_modality", "owner_user_id", "to_modality"]);
    expect(lines.join("\n")).not.toContain("Secret Lift Name");
    expect(logged("custom_exercise_updated")).toEqual([]);
  });

  it("a refused fork logs the same line with the origin's id", async () => {
    const { app, user, logged } = await setup(true);
    const res = await app.inject({ method: "POST", url: `/v1/exercises/${BUILT_IN}/fork`, headers: JSON_HEADERS, payload: { modality: "duration" } });
    expect(res.statusCode).toBe(409);
    expect(logged("custom_exercise_type_change_refused")).toEqual([
      expect.objectContaining({ exercise_id: BUILT_IN, owner_user_id: user.id, from_modality: "weight_reps", to_modality: "duration" }),
    ]);
  });
});
