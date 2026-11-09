import { describe, expect, it } from "vitest";
import { SetEntrySchema, type SetEntry, type WorkoutExerciseDetail } from "@sin/core";

import type { OutboxOp } from "./outbox/ops";
import { confirmationLine, offeredRow, statusLineText, undoAnnouncement, undoLine, undoName, undoPhase, type UndoOffer } from "./undoOffer";

const SERVER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000009";
const CLIENT_KEY = "00000000-0000-4000-8000-00000000000c";

const set = (o: Record<string, unknown> = {}): SetEntry =>
  SetEntrySchema.parse({
    id: SERVER_ID,
    workoutExerciseId: "00000000-0000-4000-8000-000000000002",
    clientGeneratedId: null,
    setNumber: 2,
    setType: "working",
    reps: 8,
    weight: 60,
    weightUnit: "kg",
    weightKg: 60,
    distance: null,
    distanceUnit: null,
    distanceM: null,
    durationS: null,
    calories: null,
    rpe: null,
    isComplete: true,
    completedAt: "2026-10-02T10:00:00.000Z",
    createdAt: "2026-10-02T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    ...o,
  });

const opBase = {
  id: "op-1",
  workoutId: "w1",
  userId: "u1",
  workoutExerciseId: "e1",
  status: "queued",
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
} as const;
const del = (target: { setId: string } | { clientGeneratedId: string }, status: "queued" | "sending" | "failed" = "queued"): OutboxOp => ({
  ...opBase,
  status,
  kind: "delete",
  target,
  body: null,
});

const offer = (s: SetEntry): UndoOffer => ({ exerciseId: "e1", exerciseName: "Bench Press", modality: "weight_reps", set: s, value: "60 × 8", restStartedAt: null });
const listOf = (...sets: SetEntry[]) => [{ id: "e1", sets } as unknown as WorkoutExerciseDetail];

describe("17.5 AC2 — the line's text", () => {
  it("a message replaces the confirmation", () => {
    expect(statusLineText({ undo: null, messages: ["1 set not saved yet"], confirmation: "Set 2 logged · 60 × 8" })).toBe("1 set not saved yet");
  });
  it("the confirmation shows when nothing else applies", () => {
    expect(statusLineText({ undo: null, messages: [], confirmation: "Set 2 logged · 60 × 8" })).toBe("Set 2 logged · 60 × 8");
  });
  it("Undo's result and 17.4's messages join with a middle dot", () => {
    expect(statusLineText({ undo: "Set 2 undone", messages: ["Log at least one set to finish"], confirmation: null })).toBe("Set 2 undone · Log at least one set to finish");
  });
  it("is empty with nothing to say", () => {
    expect(statusLineText({ undo: null, messages: [], confirmation: null })).toBe("");
  });
  it("names the offer and its button", () => {
    expect(confirmationLine(2, "47.5 × 6")).toBe("Set 2 logged · 47.5 × 6");
    expect(undoName(2, "47.5 × 6", "Bench Press")).toBe("Undo set 2, 47.5 × 6, Bench Press");
  });
});

describe("17.5 AC6 — honest wording", () => {
  it("no ops: undone", () => {
    const phase = undoPhase(set(), [], {});
    expect(phase).toBe("undone");
    expect(undoLine(phase, 2)).toBe("Set 2 undone");
    expect(undoAnnouncement(phase, 2)).toBe("Set 2 undone");
  });
  it("a queued delete with a client-key target: undoing", () => {
    const row = set({ id: CLIENT_KEY, clientGeneratedId: CLIENT_KEY });
    const phase = undoPhase(row, [del({ clientGeneratedId: CLIENT_KEY })], {});
    expect(phase).toBe("undoing");
    expect(undoLine(phase, 2)).toBe("Undoing set 2…");
    expect(undoAnnouncement(phase, 2)).toBe("Undoing set 2");
  });
  it("a delete by server id, for a row shown under its client key: undoing, through the id map", () => {
    const row = set({ id: CLIENT_KEY, clientGeneratedId: CLIENT_KEY });
    expect(undoPhase(row, [del({ setId: SERVER_ID })], { [CLIENT_KEY]: { setId: SERVER_ID, workoutId: "w1" } })).toBe("undoing");
  });
  it("a failed delete: failed, and the line says nothing of its own", () => {
    const phase = undoPhase(set(), [del({ setId: SERVER_ID }, "failed")], {});
    expect(phase).toBe("failed");
    expect(undoLine(phase, 2)).toBeNull();
    expect(undoAnnouncement(phase, 2)).toBeNull();
  });
  it("another set's ops don't count", () => {
    expect(undoPhase(set(), [del({ setId: OTHER_ID })], {})).toBe("undone");
  });
  it("a note op on the same exercise doesn't count", () => {
    const note: OutboxOp = { ...opBase, kind: "note", body: { notes: "x" } };
    expect(undoPhase(set(), [note], {})).toBe("undone");
  });
});

describe("17.5 AC8 — the offer needs its set", () => {
  it("finds the row by id", () => {
    const row = set();
    expect(offeredRow(offer(row), listOf(row))).toBe(row);
  });
  it("finds the row by client key after it took a server id", () => {
    const queued = set({ id: CLIENT_KEY, clientGeneratedId: CLIENT_KEY });
    const synced = set({ id: SERVER_ID, clientGeneratedId: CLIENT_KEY });
    expect(offeredRow(offer(queued), listOf(synced))).toBe(synced);
  });
  it("null when the row is absent", () => {
    expect(offeredRow(offer(set()), listOf(set({ id: OTHER_ID })))).toBeNull();
  });
  it("null when the exercise is absent", () => {
    expect(offeredRow(offer(set()), [])).toBeNull();
  });
  it("null when a value changed", () => {
    expect(offeredRow(offer(set()), listOf(set({ reps: 9 })))).toBeNull();
  });
  it("still found when only updatedAt changed", () => {
    const later = set({ updatedAt: "2026-10-02T11:00:00.000Z" });
    expect(offeredRow(offer(set()), listOf(later))).toBe(later);
  });
  it("a null client key never matches another null client key", () => {
    expect(offeredRow(offer(set({ clientGeneratedId: null })), listOf(set({ id: OTHER_ID, clientGeneratedId: null })))).toBeNull();
  });
});
