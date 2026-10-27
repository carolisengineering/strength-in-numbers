import { normalizeExerciseName, readWorkoutText, type CreateExercise, type Exercise } from "@sin/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../../api";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { USER_ID } from "../../../test/catalogHarness";
import { HIRAYA_TEXT, importCatalog } from "../../../test/importFixtures";
import { lookupIn } from "../exerciseLookup";
import { LIMIT_MESSAGE, OFFLINE_SAVE, RATE_LIMITED } from "../messages";
import { actions, reduce, type Draft } from "../routineDraft";
import { toRoutineInput } from "../validateDraft";
import { cardNames, initialCards } from "./cards";
import { buildHandoff, type PendingExercise } from "./handoff";
import { draftFromImport } from "./importDraft";
import { EXERCISE_LIMIT_MESSAGE } from "../../catalog/fieldErrors";
import { createFailed } from "./messages";
import { prepareImportBody, referencedPending, withExerciseIds, type SaveImportDeps, type SaveRecord } from "./saveImport";

const read = readWorkoutText(HIRAYA_TEXT);
const placeholders = new Map<string, string>();
const placeholderFor = (k: string) => placeholders.get(k) ?? (placeholders.set(k, crypto.randomUUID()), placeholders.get(k)!);
const handoff = buildHandoff({ read, cards: initialCards(cardNames(read), importCatalog), rows: importCatalog, placeholderFor });
const pending = handoff.pending;
const pendingInfo = new Map([...pending].map(([id, p]) => [id, { name: p.input.name, modality: p.input.modality }]));
const lookup = lookupIn(importCatalog, { synced: true, pending: pendingInfo });
const draft = draftFromImport(handoff.plan, (k) => handoff.exerciseIdOf.get(k)!);
const bodyOf = (d: Draft) => toRoutineInput(d, { modalityOf: (id) => lookup(id).modality });
const body = bodyOf(draft);
const newRecord = (): SaveRecord => ({ created: new Map(), attempts: 0 });
const phOf = (name: string) => placeholderFor(normalizeExerciseName(name));
const without = (d: Draft, name: string) => d.items.filter((i) => i.exerciseId === phOf(name)).reduce((acc, i) => reduce(acc, actions.remove(i.key)), d);

let minted = 100;
function fakeDeps(options: { hold?: boolean; failOn?: string; error?: ApiError | Error; loseOn?: string } = {}) {
  const calls: string[] = [];
  const visible: Exercise[] = [...importCatalog];
  const held: Array<() => void> = [];
  let failOn = options.failOn;
  let loseOn = options.loseOn;
  const createCustom = vi.fn(async (input: CreateExercise) => {
    calls.push(`create:${input.name}`);
    if (options.hold) await new Promise<void>((resolve) => held.push(resolve));
    if (input.name === failOn) throw options.error ?? new ApiError({ status: 500, type: "about:blank", title: "Server error", requestId: "req-fake" });
    const row = makeExercise({ id: exerciseId(minted++), name: input.name, modality: input.modality, ownerUserId: USER_ID, primaryMuscleId: null, equipmentId: null });
    visible.push(row);
    if (input.name === loseOn) {
      loseOn = undefined;
      throw ApiError.network("req-lost", new TypeError("Failed to fetch"));
    }
    return row;
  });
  const deps: SaveImportDeps = {
    createCustom,
    refresh: async (force: boolean) => void calls.push(`refresh:${force}`),
    visibleRows: () => visible,
  };
  return {
    deps,
    calls,
    createCustom,
    heal: () => (failOn = undefined),
    releaseNext: () => held.shift()?.(),
  };
}

beforeEach(() => observability.reportError.mockReset());

describe("10.4 AC31 — creates in order, one at a time, then real ids in the body", () => {
  it("first-appearance order; each create awaited before the next; no placeholder left", async () => {
    const f = fakeDeps({ hold: true });
    const p = prepareImportBody({ body, draft, pending, record: newRecord(), atLimit: false }, f.deps);
    await vi.waitFor(() => expect(f.calls).toEqual(["create:Hand Release Pushups"]));
    f.releaseNext();
    await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    f.releaseNext();
    await vi.waitFor(() => expect(f.calls).toHaveLength(3));
    f.releaseNext();
    const r = await p;
    expect(f.calls).toEqual(["create:Hand Release Pushups", "create:Front Raise", "create:Reverse Fly"]);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.ok && r.body)).not.toMatch(new RegExp([...pending.keys()].join("|")));
  });
  it("referencedPending and withExerciseIds", () => {
    expect(referencedPending(draft, pending)).toEqual(["Hand Release Pushups", "Front Raise", "Reverse Fly"].map(phOf));
    const swapped = withExerciseIds(body, new Map([[phOf("Front Raise"), exerciseId(7)]]));
    expect(swapped.items.filter((i) => i.exerciseId === exerciseId(7))).toHaveLength(1);
    expect(body.items.some((i) => i.exerciseId === exerciseId(7))).toBe(false); // the input is not changed
  });
});

describe("10.4 AC33 — a pending exercise with no items left is not created", () => {
  it("removed items", async () => {
    const f = fakeDeps();
    const d = without(draft, "Reverse Fly");
    await prepareImportBody({ body: bodyOf(d), draft: d, pending, record: newRecord(), atLimit: false }, f.deps);
    expect(f.calls).toEqual(["create:Hand Release Pushups", "create:Front Raise"]);
  });
});

describe("10.4 AC32 — failure and retry never create twice", () => {
  it("a failed create stops; the next Save reuses earlier creates and refreshes first", async () => {
    const record = newRecord();
    const f = fakeDeps({ failOn: "Front Raise" });
    expect(await prepareImportBody({ body, draft, pending, record, atLimit: false }, f.deps)).toEqual({ ok: false, message: createFailed("Front Raise"), requestId: "req-fake" });
    expect(record.created.size).toBe(1);
    f.heal();
    expect((await prepareImportBody({ body, draft, pending, record, atLimit: false }, f.deps)).ok).toBe(true);
    expect(f.calls).toEqual(["create:Hand Release Pushups", "create:Front Raise", "refresh:true", "create:Front Raise", "create:Reverse Fly"]);
  });

  it("a lost response: the retry finds the exercise by name and does not create it", async () => {
    const record = newRecord();
    const f = fakeDeps({ loseOn: "Front Raise" });
    expect(await prepareImportBody({ body, draft, pending, record, atLimit: false }, f.deps)).toEqual({ ok: false, message: OFFLINE_SAVE, requestId: null });
    const r = await prepareImportBody({ body, draft, pending, record, atLimit: false }, f.deps);
    expect(r.ok).toBe(true);
    expect(f.calls).toEqual(["create:Hand Release Pushups", "create:Front Raise", "refresh:true", "create:Reverse Fly"]);
    const created = f.deps.visibleRows().find((e) => e.name === "Front Raise")!;
    expect(r.ok && r.body.items.some((i) => i.exerciseId === created.id)).toBe(true);
  });

  it.each([
    [409, "exercise-limit-reached", EXERCISE_LIMIT_MESSAGE, null],
    [429, "rate-limited", RATE_LIMITED, null],
    [422, "validation-error", createFailed("Hand Release Pushups"), "req-x"],
  ] as const)("%i %s → its message", async (status, type, message, requestId) => {
    const f = fakeDeps({ failOn: "Hand Release Pushups", error: new ApiError({ status, type, title: "t", requestId: "req-x" }) });
    expect(await prepareImportBody({ body, draft, pending, record: newRecord(), atLimit: false }, f.deps)).toEqual({ ok: false, message, requestId });
    expect(f.calls).toEqual(["create:Hand Release Pushups"]);
  });

  it("a non-ApiError is reported with static tags only", async () => {
    const f = fakeDeps({ failOn: "Hand Release Pushups", error: new Error("boom Hand Release Pushups") });
    expect(await prepareImportBody({ body, draft, pending, record: newRecord(), atLimit: false }, f.deps)).toEqual({ ok: false, message: createFailed("Hand Release Pushups"), requestId: null });
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError.mock.calls[0]![1]).toEqual({ source: "routine-import", op: "create-exercise" });
  });

  it("a renamed New card is created afresh (Review Focus 4)", async () => {
    const record: SaveRecord = { created: new Map([[phOf("Front Raise"), { id: exerciseId(55), nameKey: "frontraise" }]]), attempts: 1 };
    const renamed = new Map<string, PendingExercise>(pending);
    const old = renamed.get(phOf("Front Raise"))!;
    renamed.set(phOf("Front Raise"), { ...old, input: { ...old.input, name: "Front Raises Cable" } });
    const f = fakeDeps();
    await prepareImportBody({ body, draft, pending: renamed, record, atLimit: false }, f.deps);
    expect(f.calls).toContain("create:Front Raises Cable");
  });

  it("removing the failing exercise's items, the next Save creates only what remains (Review Focus 3)", async () => {
    const record = newRecord();
    const f = fakeDeps({ failOn: "Front Raise" });
    await prepareImportBody({ body, draft, pending, record, atLimit: false }, f.deps);
    const d = without(draft, "Front Raise");
    expect((await prepareImportBody({ body: bodyOf(d), draft: d, pending, record, atLimit: false }, f.deps)).ok).toBe(true);
    expect(f.calls).toEqual(["create:Hand Release Pushups", "create:Front Raise", "refresh:true", "create:Reverse Fly"]);
  });

  it("a Save cancelled mid-sequence creates nothing more", async () => {
    const f = fakeDeps({ hold: true });
    const controller = new AbortController();
    const p = prepareImportBody({ body, draft, pending, record: newRecord(), atLimit: false, signal: controller.signal }, f.deps);
    await vi.waitFor(() => expect(f.calls).toEqual(["create:Hand Release Pushups"]));
    controller.abort();
    f.releaseNext();
    expect((await p).ok).toBe(false);
    expect(f.calls).toEqual(["create:Hand Release Pushups"]);
  });

  it("a recorded exercise that has left the list since is created afresh on the retry", async () => {
    const record: SaveRecord = { created: new Map([[phOf("Hand Release Pushups"), { id: exerciseId(77), nameKey: normalizeExerciseName("Hand Release Pushups") }]]), attempts: 1 };
    const f = fakeDeps();
    const r = await prepareImportBody({ body, draft, pending, record, atLimit: false }, f.deps);
    expect(f.calls[1]).toBe("create:Hand Release Pushups");
    expect(r.ok && r.body.items.some((i) => i.exerciseId === exerciseId(77))).toBe(false);
  });

  it("at the routine limit nothing is created", async () => {
    const f = fakeDeps();
    expect(await prepareImportBody({ body, draft, pending, record: newRecord(), atLimit: true }, f.deps)).toEqual({ ok: false, message: LIMIT_MESSAGE, requestId: null });
    expect(f.calls).toEqual([]);
  });
});
