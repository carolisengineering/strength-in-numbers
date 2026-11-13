import { describe, expect, it, vi } from "vitest";

vi.mock("../../../observability/track", () => ({ track: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: vi.fn() }));

import { memoryStorageAdapter } from "../../../storage/storage";
import {
  combine,
  isSectionOp,
  isSetOp,
  OUTBOX_OP_KINDS,
  OutboxFileSchema,
  sectionOpsState,
  sectionKey,
  unsavedNotes,
  unsavedSets,
  unsavedTimerEntries,
  type NoteOp,
  type OutboxOp,
  type ResultOp,
  type RoundOp,
} from "./ops";
import { createOutbox, OUTBOX_KEY } from "./outbox";

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
const r = (sectionId: string, round: number, seconds: number | null, over: Partial<RoundOp> = {}): RoundOp => ({ ...common(), kind: "round", sectionId, round, body: { seconds }, ...over });
const res = (sectionId: string, body: ResultOp["body"], over: Partial<ResultOp> = {}): ResultOp => ({ ...common(), kind: "result", sectionId, body, ...over });
const note = (we: string): NoteOp => ({ ...common(), workoutExerciseId: we, kind: "note", body: { notes: "x" } });
const summary = (ops: OutboxOp[]) => ops.map((o) => (isSectionOp(o) ? `${o.kind}:${sectionKey(o)}=${JSON.stringify(o.body)}` : o.kind));
const file = (ops: unknown[]) => ({ v: 1, userId: "u", ops, idMap: {} });

describe("10.7 AC34 — section op shapes on disk", () => {
  it("round set, round clear and result ops pass the file schema", () => {
    expect(OutboxFileSchema.safeParse(file([r("s1", 2, 221), r("s1", 3, null), res("s1", { capped: true, rounds: 4, reps: 7 })])).success).toBe(true);
  });

  it("a stray workoutExerciseId on a round op is stripped", () => {
    const parsed = OutboxFileSchema.parse(file([{ ...r("s1", 1, 200), workoutExerciseId: "we" }]));
    expect(parsed.ops[0]).not.toHaveProperty("workoutExerciseId");
  });

  it.each<[string, unknown]>([
    ["round 0", r("s1", 0, 200)],
    ["round 101", r("s1", 101, 200)],
    ["seconds 0", r("s1", 1, 0)],
    ["no sectionId", { ...r("s1", 1, 200), sectionId: undefined }],
  ])("%s fails", (_name, op) => {
    expect(OutboxFileSchema.safeParse(file([op])).success).toBe(false);
  });

  it("the known kinds now include round and result", () => {
    expect([...OUTBOX_OP_KINDS].sort()).toEqual(["create", "delete", "note", "result", "round", "update"]);
  });

  it("a file with only set and note ops serializes exactly as before", () => {
    vi.useFakeTimers({ now: 1_000 });
    const storage = memoryStorageAdapter();
    let i = 0;
    const outbox = createOutbox({
      storage,
      rest: { createSet: vi.fn(), updateSet: vi.fn(), deleteSet: vi.fn(), setExerciseNote: vi.fn() } as never,
      userId: "u1",
      isOnline: () => false,
      newId: () => `op-${++i}`,
    });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: "30000000-0000-4000-8000-000000000001", weight: 60, weightUnit: "kg", reps: 8, isComplete: true } });
    outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "Pause" } });
    vi.useRealTimers();
    expect(storage.get(OUTBOX_KEY)).toBe(
      '{"v":1,"userId":"u1","ops":[{"id":"op-1","workoutId":"w","workoutExerciseId":"we","userId":"u1","status":"queued","attempted":false,"attempts":0,"nextAttemptAt":1000,"enqueuedAt":1000,"kind":"create","target":{"clientGeneratedId":"30000000-0000-4000-8000-000000000001"},"body":{"clientGeneratedId":"30000000-0000-4000-8000-000000000001","weight":60,"weightUnit":"kg","reps":8,"isComplete":true}},{"id":"op-2","workoutId":"w","workoutExerciseId":"we","userId":"u1","status":"queued","attempted":false,"attempts":0,"nextAttemptAt":1000,"enqueuedAt":1000,"kind":"note","body":{"notes":"Pause"}}],"idMap":{}}',
    );
  });
});

describe("10.7 AC35 — combine for round and result ops", () => {
  it.each<[string, OutboxOp[], OutboxOp, string[]]>([
    ["same key, last of the section → replace", [r("s1", 2, 515)], r("s1", 2, 520), ['round:s1:2={"seconds":520}']],
    [
      "another round of the section came after → append (Review Focus 5)",
      [r("s1", 2, 515), r("s1", 1, 250)],
      r("s1", 2, 520),
      ['round:s1:2={"seconds":515}', 'round:s1:1={"seconds":250}', 'round:s1:2={"seconds":520}'],
    ],
    ["another section's op doesn't count", [r("s1", 2, 515), r("s2", 1, 250)], r("s1", 2, 520), ['round:s1:2={"seconds":520}', 'round:s2:1={"seconds":250}']],
    ["a note after the round doesn't block", [r("s1", 2, 515), note("e1")], r("s1", 2, 520), ['round:s1:2={"seconds":520}', "note"]],
    ["the last op was attempted → append", [r("s1", 2, 515, { attempted: true })], r("s1", 2, 520), ['round:s1:2={"seconds":515}', 'round:s1:2={"seconds":520}']],
    ["the last op is sending → append", [r("s1", 2, 515, { status: "sending" })], r("s1", 2, 520), ['round:s1:2={"seconds":515}', 'round:s1:2={"seconds":520}']],
    [
      "failed with 409 → append",
      [r("s1", 2, 515, { status: "failed", failure: { status: 409, type: "section-timer-mismatch", requestId: null } })],
      r("s1", 2, 520),
      ['round:s1:2={"seconds":515}', 'round:s1:2={"seconds":520}'],
    ],
    ["a result then its clear → one op, body null", [res("s1", { rounds: 5, reps: 7 })], res("s1", null), ["result:s1:result=null"]],
    ["a result then a round of the same section → append", [res("s1", { rounds: 5, reps: 7 })], r("s1", 3, 770), ['result:s1:result={"rounds":5,"reps":7}', 'round:s1:3={"seconds":770}']],
  ])("%s", (_name, ops, incoming, expected) => {
    expect(summary(combine(ops, incoming))).toEqual(expected);
  });

  it("failed with 422 → reset to queued with the new body", () => {
    const failed = r("s1", 2, 515, { status: "failed", attempted: true, attempts: 1, failure: { status: 422, type: "validation-error", requestId: null } });
    const [op] = combine([failed], r("s1", 2, 520, { enqueuedAt: 99 }));
    expect(op).toMatchObject({ id: failed.id, status: "queued", attempted: false, attempts: 0, nextAttemptAt: 99, body: { seconds: 520 } });
    expect(op).not.toHaveProperty("failure", expect.anything());
  });

  it("a replace keeps the op's place in the queue", () => {
    const ops = [r("s1", 2, 515), note("e1")];
    expect(combine(ops, r("s1", 2, 520))[0]!.id).toBe(ops[0]!.id);
  });
});

describe("10.7 AC39 — counters (Review Focus 1)", () => {
  it("one queued round op is a timer entry, never a set or a note", () => {
    const ops = [r("s1", 1, 200)];
    expect(unsavedSets(ops, "w", {})).toEqual({ pending: 0, failed: 0 });
    expect(unsavedNotes(ops, "w")).toEqual({ pending: 0, failed: 0 });
    expect(unsavedTimerEntries(ops, "w")).toEqual({ pending: 1, failed: 0 });
  });

  it("two ops for the same key count once; a failed one counts as failed; another workout's don't count", () => {
    const ops = [r("s1", 1, 200), r("s1", 1, 210, { attempted: true }), res("s1", null, { status: "failed" }), r("s1", 2, 300, { workoutId: "other" })];
    expect(unsavedTimerEntries(ops, "w")).toEqual({ pending: 1, failed: 1 });
  });

  it("isSetOp names the three set kinds only", () => {
    expect(isSetOp(r("s1", 1, 200))).toBe(false);
    expect(isSetOp(res("s1", null))).toBe(false);
    expect(isSetOp(note("e1"))).toBe(false);
  });

  it("10.7 AC40 / minor 328 — sectionOpsState: none, pending, failed only when every op of the section failed", () => {
    expect(sectionOpsState([note("e1"), r("s2", 1, 200)], "s1")).toBe("none");
    expect(sectionOpsState([r("s1", 1, 200)], "s1")).toBe("pending");
    expect(sectionOpsState([r("s1", 1, 200, { status: "failed" }), res("s1", null, { status: "failed" })], "s1")).toBe("failed");
    expect(sectionOpsState([r("s1", 1, 200, { status: "failed" }), r("s1", 2, 210)], "s1")).toBe("pending");
  });

});
