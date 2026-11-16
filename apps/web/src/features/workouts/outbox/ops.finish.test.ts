import { describe, expect, it } from "vitest";
import { isFinishOp, isSetOp, OUTBOX_OP_KINDS, OutboxFileSchema, parseOutboxFile, type FinishOp, type OutboxOp } from "./ops";

const KEY = "30000000-0000-4000-8000-000000000001";
const SET = "40000000-0000-4000-8000-000000000001";
let n = 0;
const common = () => ({
  id: `op-${++n}`,
  workoutId: "w",
  userId: "u",
  status: "queued" as const,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
});
const finish = (over: Partial<FinishOp> = {}): FinishOp => ({
  ...common(),
  kind: "finish",
  body: { endedAt: "2026-11-08T10:15:00.000Z" },
  meta: { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 3, setCount: 12, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  ...over,
});
// The previous release's file: set, note, round and result ops only.
const previousRelease = (): OutboxOp[] => [
  { ...common(), workoutExerciseId: "we", kind: "create", target: { clientGeneratedId: KEY }, body: { clientGeneratedId: KEY, weight: 60, weightUnit: "kg", reps: 8, isComplete: true } },
  { ...common(), workoutExerciseId: "we", kind: "update", target: { setId: SET }, body: { reps: 9 } },
  { ...common(), workoutExerciseId: "we", kind: "delete", target: { setId: SET }, body: null },
  { ...common(), workoutExerciseId: "we", kind: "note", body: { notes: "Pause" } },
  { ...common(), sectionId: "s1", kind: "round", round: 2, body: { seconds: 515 } },
  { ...common(), sectionId: "s1", kind: "result", body: null },
];
const file = (ops: unknown[]) => ({ v: 1, userId: "u", ops, idMap: { [KEY]: { setId: SET, workoutId: "w" } } });

describe("06.7 AC1 — a finish op exists and persists", () => {
  it("a file holding a finish op round-trips through JSON and parseOutboxFile, still v: 1", () => {
    const ops = [...previousRelease(), finish({ body: { endedAt: "2026-11-08T10:15:00.000Z", keepRoutine: true } })];
    const written = JSON.parse(JSON.stringify(file(ops)));
    expect(written.v).toBe(1);
    expect(OutboxFileSchema.safeParse(written).success).toBe(true);
    expect(parseOutboxFile(written)).toEqual({ userId: "u", ops, idMap: { [KEY]: { setId: SET, workoutId: "w" } }, skipped: 0 });
  });

  it("a failed finish op keeps its failure and blockedBy", () => {
    const op = finish({ status: "failed", failure: { status: 422, type: "validation", requestId: "r1", blockedBy: "op-0" } });
    expect(parseOutboxFile(file([op]))?.ops).toEqual([op]);
  });

  it("a file written by the previous release loads unchanged", () => {
    const ops = previousRelease();
    expect(parseOutboxFile(JSON.parse(JSON.stringify(file(ops))))).toEqual({
      userId: "u",
      ops,
      idMap: { [KEY]: { setId: SET, workoutId: "w" } },
      skipped: 0,
    });
  });

  it("isSetOp is false for a finish op, isFinishOp true only for it", () => {
    expect(isSetOp(finish())).toBe(false);
    expect(isFinishOp(finish())).toBe(true);
    expect(previousRelease().some(isFinishOp)).toBe(false);
  });

  it("OUTBOX_OP_KINDS knows finish", () => {
    expect(OUTBOX_OP_KINDS.has("finish")).toBe(true);
  });

  it("a finish op whose meta holds a string where a number belongs makes the file unreadable (10.7 AC66: a known kind failing its schema), without throwing", () => {
    const bad = { ...finish(), meta: { ...finish().meta, setCount: "12" } };
    expect(() => parseOutboxFile(file([bad]))).not.toThrow();
    expect(parseOutboxFile(file([bad]))).toBeNull();
  });

  it("keepRoutine is only ever true on the wire (10.5 AC13): a stored false makes the file unreadable", () => {
    const parsed = parseOutboxFile(file([{ ...finish(), body: { endedAt: "2026-11-08T10:15:00.000Z", keepRoutine: false } }]));
    expect(parsed).toBeNull();
  });
});
