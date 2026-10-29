import type { HevyFolder, HevyRoutine, HevyTemplate, HevyWorkout } from "@sin/core";

import type { HevyClient } from "../client/hevyClient";
import { HevyError } from "../client/hevyErrors";
import { listAll } from "../client/listAll";
import { READ_STAGES, type ReadStage } from "./constants";

export type { ReadStage } from "./constants";

/**
 * Spec 20.1 AC3–AC5, §6.3: everything the import needs from Hevy, read in order through the shared pacer. In memory
 * only. React-free: the hook passes the signal and the templates read, and turns progress into state.
 */

export interface HevyRead {
  workoutCount: number;
  templates: Map<string, HevyTemplate>;
  folders: HevyFolder[];
  routines: HevyRoutine[];
  /** Keyed by id, so a workout served twice by shifting pages is held once (AC4). */
  workouts: Map<string, HevyWorkout>;
}

export interface ReadProgress {
  stage: ReadStage;
  /** 0 while a stage has no page count yet (the count, and the templates, whose pages `useTemplatesProgress` reports). */
  page: number;
  pageCount: number;
}

/**
 * A stage that still failed after the client's retries (AC5). `partial` holds the stages read before it, so
 * **Try again** restarts only this stage (`readHevy(…, { from: stage, previous: partial })`).
 */
export class ReadStageError extends Error {
  readonly stage: ReadStage;
  override readonly cause: HevyError;
  readonly partial: Partial<HevyRead>;

  constructor(stage: ReadStage, cause: HevyError, partial: Partial<HevyRead>) {
    super(`Hevy read failed at ${stage}`);
    this.name = "ReadStageError";
    this.stage = stage;
    this.cause = cause;
    this.partial = partial;
  }
}

/** These end the read outright, whatever the stage: a refused key, a reply we can't read, a cancel. */
const FATAL = new Set<HevyError["kind"]>(["bad_key", "unexpected_reply", "aborted"]);

export interface ReadHevyOptions {
  signal: AbortSignal;
  /** The templates read; the hook passes `fetchQuery(hevyTemplatesQuery(client))` so a cached or running read is reused. */
  templates(signal: AbortSignal): Promise<HevyTemplate[]>;
  /** Restart at this stage (AC5 **Try again**) with the earlier stages' results in `previous`. */
  from?: ReadStage;
  previous?: Partial<HevyRead>;
  onProgress(p: ReadProgress): void;
}

/** Resolves when `work` does, or rejects as aborted the moment `signal` aborts (the templates read is shared, so it isn't ours to cancel). */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new HevyError("aborted"));
    const onAbort = () => reject(new HevyError("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export async function readHevy(client: HevyClient, opts: ReadHevyOptions): Promise<HevyRead> {
  const { signal } = opts;
  const partial: Partial<HevyRead> = { ...opts.previous };
  const startAt = READ_STAGES.indexOf(opts.from ?? "count");

  async function stage<T>(name: ReadStage, run: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new HevyError("aborted");
    try {
      return await run();
    } catch (err) {
      const failure = err instanceof HevyError ? err : signal.aborted ? new HevyError("aborted") : null;
      if (failure === null) throw err;
      if (FATAL.has(failure.kind)) throw failure;
      throw new ReadStageError(name, failure, { ...partial });
    }
  }

  async function pages<P extends { page: number; page_count: number }>(name: ReadStage, fetchPage: (page: number, s?: AbortSignal) => Promise<P>): Promise<P[]> {
    const out = await listAll(fetchPage, { signal, onPage: ({ page, pageCount }) => opts.onProgress({ stage: name, page, pageCount }) });
    if (out.error !== null) throw out.error;
    return out.pages;
  }

  const runs: Record<ReadStage, () => Promise<void>> = {
    count: async () => {
      opts.onProgress({ stage: "count", page: 0, pageCount: 0 });
      partial.workoutCount = await stage("count", () => client.workoutCount(signal));
    },
    templates: async () => {
      opts.onProgress({ stage: "templates", page: 0, pageCount: 0 });
      const list = await stage("templates", () => raceAbort(opts.templates(signal), signal));
      partial.templates = new Map(list.map((t) => [t.id, t]));
    },
    folders: async () => {
      const read = await stage("folders", () => pages("folders", (n, s) => client.listFolders(n, s)));
      partial.folders = read.flatMap((p) => p.routine_folders);
    },
    routines: async () => {
      const read = await stage("routines", () => pages("routines", (n, s) => client.listRoutines(n, s)));
      partial.routines = read.flatMap((p) => p.routines);
    },
    workouts: async () => {
      const read = await stage("workouts", () => pages("workouts", (n, s) => client.listWorkouts(n, s)));
      partial.workouts = new Map(read.flatMap((p) => p.workouts).map((w) => [w.id, w]));
    },
  };

  for (const name of READ_STAGES.slice(startAt)) await runs[name]();
  if (signal.aborted) throw new HevyError("aborted");

  return {
    workoutCount: partial.workoutCount ?? 0,
    templates: partial.templates ?? new Map(),
    folders: partial.folders ?? [],
    routines: partial.routines ?? [],
    workouts: partial.workouts ?? new Map(),
  };
}

/** AC4: Hevy's own count against the distinct workouts read. */
export function reconcile(read: HevyRead): { read: number; reported: number; differs: boolean } {
  return { read: read.workouts.size, reported: read.workoutCount, differs: read.workouts.size !== read.workoutCount };
}
