import type { CreateExercise, Exercise, HevyMapping, HevyTemplate } from "@sin/core";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../api";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { EXERCISE_LIMIT_MESSAGE } from "../../catalog/fieldErrors";
import type { PairInput } from "../mapping/useMappingMutations";
import { HEVY_COPY, MAPPING_RATE_LIMITED } from "../messages";
import type { PairingDecision } from "./pairingCards";
import { CREATE_GAP_MS, PAIR_BATCH_MAX, newPairingSaveRecord, savePairings, type SavePairingsDeps } from "./savePairings";

const tpl = (id: string, title = `Hevy ${id}`, type = "weight_reps") => ({ id, title, type, is_custom: true }) as HevyTemplate;
const create = (id: string, name = `New ${id}`): PairingDecision => ({ template: tpl(id), action: "create", create: { name, modality: "weight_reps" } as CreateExercise, rule: null });
const problem = (status: number, type: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status, type, title: type, requestId: "r", ...extra });

/** A fake clock and API: creates mint ids, the patch echoes what it was sent. */
function fakes(opts: { onCreate?: (input: CreateExercise, n: number) => void; visible?: () => Exercise[] } = {}) {
  let now = 1_000_000;
  let n = 0;
  const createdAt: number[] = [];
  const patches: PairInput[][] = [];
  const deps: SavePairingsDeps = {
    createCustom: vi.fn(async (input: CreateExercise) => {
      n += 1;
      opts.onCreate?.(input, n);
      createdAt.push(now);
      return makeExercise({ id: exerciseId(500 + n), name: input.name });
    }),
    refresh: vi.fn(async () => {}),
    visibleRows: () => opts.visible?.() ?? [],
    patchMapping: vi.fn(async (body: { upsert: PairInput[] }) => {
      patches.push(body.upsert);
      return { pairs: body.upsert.map((p) => ({ ...p, exerciseActive: p.exerciseId === null ? null : true })), sectionRules: [] } as HevyMapping;
    }),
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
    now: () => now,
  };
  return { deps, createdAt, patches };
}

describe("20.0 AC28, AC29 — savePairings writes only when called, and leaves nothing half-done", () => {
  it("creates one at a time, in order, at least 4 s apart, reporting progress", async () => {
    const { deps, createdAt } = fakes();
    const progress: string[] = [];
    const out = await savePairings(
      { decisions: [create("A"), create("B"), create("C")], record: newPairingSaveRecord(), onProgress: ({ created, total }) => void progress.push(`${created}/${total}`) },
      deps,
    );
    expect(out.ok).toBe(true);
    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
    expect(createdAt[1]! - createdAt[0]!).toBeGreaterThanOrEqual(CREATE_GAP_MS);
    expect(createdAt[2]! - createdAt[1]!).toBeGreaterThanOrEqual(CREATE_GAP_MS);
  });

  it("16 creates take at least a minute (under 15 a minute)", async () => {
    const { deps, createdAt } = fakes();
    await savePairings({ decisions: Array.from({ length: 16 }, (_, i) => create(`T${i}`)), record: newPairingSaveRecord() }, deps);
    expect(createdAt.at(-1)! - createdAt[0]!).toBeGreaterThanOrEqual(60_000);
  });

  it("a 429 waits its Retry-After and retries once; a second 429 stops before any pair is written", async () => {
    let calls = 0;
    const { deps } = fakes({
      onCreate: () => {
        calls += 1;
        if (calls === 1) throw problem(429, "rate-limited", { retryAfterMs: 9000 });
      },
    });
    expect((await savePairings({ decisions: [create("A")], record: newPairingSaveRecord() }, deps)).ok).toBe(true);
    expect(deps.sleep).toHaveBeenCalledWith(9000, undefined);

    const again = fakes({ onCreate: () => void (() => { throw problem(429, "rate-limited", { retryAfterMs: 1000 }); })() });
    const out = await savePairings({ decisions: [create("A")], record: newPairingSaveRecord() }, again.deps);
    expect(out).toEqual({ ok: false, message: MAPPING_RATE_LIMITED, stage: "create" });
    expect(again.deps.patchMapping).not.toHaveBeenCalled();
  });

  it("the exercise cap stops with its sentence and writes no pair", async () => {
    const { deps } = fakes({ onCreate: () => void (() => { throw problem(409, "exercise-limit-reached"); })() });
    const out = await savePairings({ decisions: [create("A")], record: newPairingSaveRecord() }, deps);
    expect(out).toEqual({ ok: false, message: EXERCISE_LIMIT_MESSAGE, stage: "create" });
    expect(deps.patchMapping).not.toHaveBeenCalled();
  });

  it("a retry after a lost response refreshes, reuses what exists, and creates each name once (Review Focus 3)", async () => {
    const made: Exercise[] = [];
    let lose = true;
    const { deps } = fakes({
      onCreate: (input, n) => {
        made.push(makeExercise({ id: exerciseId(500 + n), name: input.name }));
        if (n === 2 && lose) {
          lose = false;
          throw new ApiError({ status: 0, type: "network", title: "network", requestId: "r", isNetworkError: true });
        }
      },
      visible: () => made,
    });
    const record = newPairingSaveRecord();
    const decisions = [create("A", "Alpha"), create("B", "Bravo")];
    expect((await savePairings({ decisions, record }, deps)).ok).toBe(false);
    const out = await savePairings({ decisions, record }, deps);
    expect(out.ok).toBe(true);
    expect(deps.refresh).toHaveBeenCalledWith(true);
    expect((deps.createCustom as ReturnType<typeof vi.fn>).mock.calls.map(([i]) => (i as CreateExercise).name)).toEqual(["Alpha", "Bravo"]);
  });

  it("pairs go in batches of 200, in order: created and paired exercises, skips, exportAs false, title and type from the template", async () => {
    const { deps, patches } = fakes();
    const pairs: PairingDecision[] = Array.from({ length: 250 }, (_, i) => ({ template: tpl(`P${i}`), action: "pair", exerciseId: exerciseId(1), rule: null }));
    const decisions: PairingDecision[] = [create("C"), ...pairs, { template: tpl("S", "Stretching", "duration"), action: "skip" }];
    const out = await savePairings({ decisions, record: newPairingSaveRecord() }, deps);
    expect(out.ok).toBe(true);
    expect(PAIR_BATCH_MAX).toBe(200);
    expect(patches.map((b) => b.length)).toEqual([200, 52]);
    const all = patches.flat();
    expect(all[0]).toEqual({ hevyTemplateId: "C", hevyTitle: "Hevy C", hevyType: "weight_reps", role: "exercise", exerciseId: exerciseId(501), measureRule: null, exportAs: false });
    expect(all.at(-1)).toEqual({ hevyTemplateId: "S", hevyTitle: "Stretching", hevyType: "duration", role: "skip", exerciseId: null, measureRule: null, exportAs: false });
    expect(all.every((p) => p.exportAs === false)).toBe(true);
  });

  it("an abort between creates stops: no further create, no pairs", async () => {
    const controller = new AbortController();
    const { deps } = fakes({ onCreate: (_i, n) => void (n === 1 ? controller.abort() : undefined) });
    const out = await savePairings({ decisions: [create("A"), create("B")], record: newPairingSaveRecord(), signal: controller.signal }, deps);
    expect(out.ok).toBe(false);
    expect(deps.createCustom).toHaveBeenCalledTimes(1);
    expect(deps.patchMapping).not.toHaveBeenCalled();
  });
});

describe("20.0 AC28 — a cancel during a wait is a stop, not a failure (code review)", () => {
  /** The real shared sleep rejects with an AbortError when its signal aborts. */
  const abortingSleep = (controller: AbortController) =>
    vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

  it("during the gap between creates", async () => {
    const controller = new AbortController();
    const { deps, patches } = fakes();
    deps.sleep = abortingSleep(controller);
    const out = await savePairings({ decisions: [create("A"), create("B")], record: newPairingSaveRecord(), signal: controller.signal }, deps);
    expect(out).toEqual({ ok: false, message: HEVY_COPY.aborted, stage: "create" });
    expect(patches).toEqual([]);
  });

  it("during a 429's Retry-After wait", async () => {
    const controller = new AbortController();
    const { deps, patches } = fakes({
      onCreate: () => {
        throw problem(429, "rate-limited", { retryAfterMs: 30_000 });
      },
    });
    deps.sleep = abortingSleep(controller);
    const out = await savePairings({ decisions: [create("A")], record: newPairingSaveRecord(), signal: controller.signal }, deps);
    expect(out).toEqual({ ok: false, message: HEVY_COPY.aborted, stage: "create" });
    expect(patches).toEqual([]);
  });
});
