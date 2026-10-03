import { describe, expect, it } from "vitest";
import { combine, OutboxFileSchema, type CreateOp, type DeleteOp, type OutboxOp, type UpdateOp } from "./ops";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY9 = "30000000-0000-4000-8000-000000000009";
const SET = "40000000-0000-4000-8000-000000000001";
let n = 0;
const base = () => ({
  id: `op-${++n}`,
  workoutId: "w",
  workoutExerciseId: "we",
  userId: "u",
  status: "queued" as const,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
});
const create = (over: Partial<CreateOp> = {}): CreateOp => ({
  ...base(),
  kind: "create",
  target: { clientGeneratedId: KEY },
  body: { clientGeneratedId: KEY, weight: 60, weightUnit: "kg", reps: 8, isComplete: true },
  ...over,
});
const update = (body: UpdateOp["body"], over: Partial<UpdateOp> = {}): UpdateOp => ({
  ...base(),
  kind: "update",
  target: { clientGeneratedId: KEY },
  body,
  ...over,
});
const del = (over: Partial<DeleteOp> = {}): DeleteOp => ({
  ...base(),
  kind: "delete",
  target: { clientGeneratedId: KEY },
  body: null,
  ...over,
});

describe("06.2 AC2 — ops never attempted are combined", () => {
  it("an edit of a queued create merges into the create's body", () => {
    const out = combine([create()], update({ weight: 62.5 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "create", body: { weight: 62.5, reps: 8, clientGeneratedId: KEY } });
  });

  it("a delete of a queued create removes both", () => {
    expect(combine([create()], del())).toEqual([]);
  });

  it("repeated edits of a synced set merge, later fields winning", () => {
    const first = update({ weight: 60, reps: 5 }, { target: { setId: SET } });
    const out = combine([first], update({ reps: 6 }, { target: { setId: SET } }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "update", body: { weight: 60, reps: 6 } });
  });

  it("a delete replaces a queued edit, in the edit's place", () => {
    const other = create({ target: { clientGeneratedId: KEY9 }, body: { clientGeneratedId: KEY9, reps: 1, isComplete: true } });
    const edit = update({ reps: 6 }, { target: { setId: SET } });
    const out = combine([edit, other], del({ target: { setId: SET } }));
    expect(out.map((o) => o.kind)).toEqual(["delete", "create"]);
  });

  it("ops for different sets are never combined", () => {
    const out = combine(
      [update({ reps: 6 }, { target: { setId: SET } })],
      update({ reps: 7 }, { target: { setId: "other" } }),
    );
    expect(out).toHaveLength(2);
  });
});

describe("06.2 AC3 — an attempted op is frozen", () => {
  it("an edit after the create was sent is appended, not merged", () => {
    const sent = create({ attempted: true });
    const out = combine([sent], update({ weight: 62.5 }));
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(sent);
    expect(out[1]).toMatchObject({ kind: "update", body: { weight: 62.5 } });
  });

  it("a delete after the create was sent is appended", () => {
    expect(combine([create({ attempted: true })], del()).map((o) => o.kind)).toEqual(["create", "delete"]);
  });
});

describe("06.2 AC14 — editing a set whose op failed with 422 replaces the failed op", () => {
  it("a 422-failed create edited becomes a fresh queued create with the merged body", () => {
    const failed = create({
      status: "failed",
      attempted: true,
      attempts: 1,
      failure: { status: 422, type: "validation-error", requestId: "r" },
    });
    const out = combine([failed], update({ weight: 50 }, { enqueuedAt: 99 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "create",
      status: "queued",
      attempted: false,
      attempts: 0,
      nextAttemptAt: 99,
      body: { weight: 50 },
    });
    expect(out[0]!.failure).toBeUndefined();
  });

  it("a non-422 failed op is not reset by an edit", () => {
    const failed = create({
      status: "failed",
      attempted: true,
      failure: { status: 409, type: "workout-finished", requestId: null },
    });
    expect(combine([failed], update({ weight: 50 }))).toHaveLength(2);
  });
});

describe("06.2 AC7 — the persisted file schema", () => {
  it("round-trips a file and rejects a malformed one", () => {
    const ops: OutboxOp[] = [create(), update({ reps: 3 }), del()];
    const file = { v: 1, userId: "u", ops, idMap: { [KEY]: { setId: SET, workoutId: "w" } } };
    expect(OutboxFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
    expect(OutboxFileSchema.safeParse({ v: 1, userId: "u", ops: [{ kind: "create" }], idMap: {} }).success).toBe(false);
    expect(OutboxFileSchema.safeParse({ v: 2, userId: "u", ops: [], idMap: {} }).success).toBe(false);
  });
});
