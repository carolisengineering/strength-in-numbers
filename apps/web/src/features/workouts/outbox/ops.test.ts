import { describe, expect, it } from "vitest";
import { combine, OutboxFileSchema, unsavedSets, type CreateOp, type DeleteOp, type OutboxOp, type UpdateOp } from "./ops";

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

  it("a 422-rejected create with a failed follow-up edit: a new edit folds all of them into one fresh create (final review I3)", () => {
    const rejected = { status: 422, type: "validation-error", requestId: "r" };
    const failedCreate = create({ status: "failed", attempted: true, attempts: 1, failure: rejected });
    const failedEdit = update({ reps: 6 }, { status: "failed", failure: rejected });
    const out = combine([failedCreate, failedEdit], update({ weight: 55 }, { enqueuedAt: 7 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "create", status: "queued", attempted: false, nextAttemptAt: 7, body: { reps: 6, weight: 55 } });
  });

  it.each([422, 409, 404])(
    "deleting a set whose create failed (%s, never stored) drops the create and its follow-ups (code review #1)",
    (status) => {
      const failure = { status, type: "x", requestId: null };
      const failedCreate = create({ status: "failed", attempted: true, failure });
      const failedEdit = update({ reps: 6 }, { status: "failed", failure });
      const other = create({ target: { clientGeneratedId: KEY9 }, body: { clientGeneratedId: KEY9, reps: 1, isComplete: true } });
      expect(combine([failedCreate, failedEdit, other], del())).toEqual([other]);
    },
  );

  it("a non-422 failed op is not reset by an edit", () => {
    const failed = create({
      status: "failed",
      attempted: true,
      failure: { status: 409, type: "workout-finished", requestId: null },
    });
    expect(combine([failed], update({ weight: 50 }))).toHaveLength(2);
  });
});

describe("06.2 AC15, 06.2 AC16 — unsavedSets counts sets, not ops (code review #3)", () => {
  it("a create plus its edits is one set; a failed op makes its set failed; other workouts are ignored", () => {
    const attempted = create({ attempted: true });
    const edit = update({ reps: 6 });
    const edit2 = update({ reps: 7 });
    const synced = update({ reps: 2 }, { target: { setId: SET } });
    const failedOther = create({
      target: { clientGeneratedId: KEY9 },
      body: { clientGeneratedId: KEY9, reps: 1, isComplete: true },
      status: "failed",
      failure: { status: 409, type: "workout-finished", requestId: null },
    });
    const elsewhere = create({ workoutId: "other" });
    expect(unsavedSets([attempted, edit, edit2, synced, failedOther, elsewhere], "w", {})).toEqual({ pending: 2, failed: 1 });
  });

  it("an edit by server id of a set created here counts with its create", () => {
    const ops = [create({ attempted: true }), update({ reps: 6 }, { target: { setId: SET } })];
    expect(unsavedSets(ops, "w", { [KEY]: { setId: SET, workoutId: "w" } })).toEqual({ pending: 1, failed: 0 });
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
