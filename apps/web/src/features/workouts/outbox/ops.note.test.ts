import { describe, expect, it } from "vitest";
import { combine, OutboxFileSchema, unsavedNotes, unsavedSets, type CreateOp, type NoteOp, type OutboxOp, type UpdateOp } from "./ops";

const KEY = "30000000-0000-4000-8000-000000000001";
let n = 0;
const base = (over: Record<string, unknown> = {}) => ({
  id: `op-${++n}`, workoutId: "w", workoutExerciseId: "we", userId: "u", status: "queued" as const,
  attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0, ...over,
});
const note = (notes: string | null, over: Partial<NoteOp> = {}): NoteOp => ({ ...base(), kind: "note", body: { notes }, ...over });
const create = (over: Partial<CreateOp> = {}): CreateOp => ({
  ...base(), kind: "create", target: { clientGeneratedId: KEY },
  body: { clientGeneratedId: KEY, weight: 60, weightUnit: "kg", reps: 8, isComplete: true }, ...over,
});
const update = (body: UpdateOp["body"]): UpdateOp => ({ ...base(), kind: "update", target: { clientGeneratedId: KEY }, body });
const rejected = (op: NoteOp, status: number): NoteOp => ({ ...op, status: "failed", failure: { status, type: "t", requestId: null } });

describe("10.3 AC12 — combine for note ops", () => {
  it("a newer edit replaces the body of a queued, never-attempted note op for the same exercise", () => {
    const first = note("a");
    const out = combine([first], note("b"));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: first.id, kind: "note", body: { notes: "b" } });
  });

  it("clearing is an edit too (notes: null)", () => {
    expect(combine([note("a")], note(null))[0]).toMatchObject({ body: { notes: null } });
  });

  it.each([
    ["attempted (the server may already have applied it)", { attempted: true }],
    ["sending", { status: "sending" as const, attempted: true }],
    ["failed with a non-422 status", { status: "failed" as const, failure: { status: 409, type: "workout-finished", requestId: null } }],
  ])("a note op that is %s is never merged into: the edit is appended", (_name, over) => {
    const out = combine([note("a", over)], note("b"));
    expect(out).toHaveLength(2);
    expect((out[0] as NoteOp).body.notes).toBe("a");
    expect((out[1] as NoteOp).body.notes).toBe("b");
  });

  it("a note op that failed with 422 is reset and replaced by the next edit (parity with set ops)", () => {
    const failed = rejected(note("a", { attempted: true, attempts: 2 }), 422);
    const out = combine([failed], note("b", { enqueuedAt: 9 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: failed.id, status: "queued", attempted: false, attempts: 0, nextAttemptAt: 9, body: { notes: "b" } });
    expect((out[0] as NoteOp).failure).toBeUndefined();
  });

  it("note ops of different exercises never merge", () => {
    const out = combine([note("a")], note("b", { workoutExerciseId: "other" }));
    expect(out).toHaveLength(2);
  });

  it("set ops between two edits of the same note do not stop the coalescing, and notes never disturb set merging", () => {
    const first = note("a");
    const out = combine([first, create()], note("b"));
    expect(out).toHaveLength(2);
    expect((out[0] as NoteOp).body.notes).toBe("b");
    const merged = combine([note("a"), create()], update({ weight: 62.5 }));
    expect(merged.map((o) => o.kind)).toEqual(["note", "create"]);
    expect((merged[1] as CreateOp).body.weight).toBe(62.5);
  });
});

describe("10.3 AC13 — unsavedNotes / unsavedSets", () => {
  it("counts exercises, not queued edits; a failed op makes its exercise failed, not pending", () => {
    const ops: OutboxOp[] = [
      note("a"),
      note("b", { workoutExerciseId: "e2" }),
      rejected(note("c", { workoutExerciseId: "e2" }), 409),
      note("x", { workoutId: "other-workout" }),
    ];
    expect(unsavedNotes(ops, "w")).toEqual({ pending: 1, failed: 1 });
  });

  it("unsavedSets ignores note ops entirely", () => {
    expect(unsavedSets([note("a"), create()], "w", {})).toEqual({ pending: 1, failed: 0 });
    expect(unsavedSets([note("a")], "w", {})).toEqual({ pending: 0, failed: 0 });
  });
});

describe("10.3 AC12 — the persisted file", () => {
  const file = (ops: unknown[]) => ({ v: 1, userId: "u", ops, idMap: {} });
  it("round-trips a note op; v stays 1", () => {
    expect(OutboxFileSchema.safeParse(file([note("a"), note(null)])).success).toBe(true);
  });
  it("a file written before this spec (set ops only) loads unchanged", () => {
    expect(OutboxFileSchema.safeParse(file([create()])).success).toBe(true);
  });
  it("a note op with a non-string body is refused", () => {
    expect(OutboxFileSchema.safeParse(file([{ ...note("a"), body: { notes: 5 } }])).success).toBe(false);
  });
});
