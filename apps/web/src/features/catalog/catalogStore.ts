import {
  ExerciseSchema,
  ExercisesResponse,
  type CreateExercise,
  type Exercise,
} from "@sin/core";
import { z } from "zod";

import type { ApiClient } from "../../api/client";
import { reportError } from "../../observability/reportError";
import { track } from "../../observability/track";
import { isUserDataKey } from "../../storage/clearUserData";
import type { StorageAdapter } from "../../storage/storage";
import { classifySyncFailure, mergeCatalogRows, type SyncFailure } from "./catalogSync";
import {
  CATALOG_REFRESH_STALE_MS,
  MAX_RECENTS,
  catalogKey,
  recentsKey,
} from "./constants";
import type { CatalogState } from "./types";

/**
 * The React-free exercise-catalog store (Spec 06.0 §6.5). It owns the rows,
 * the recents and the sync token, mirrors them into a `StorageAdapter`, and
 * exposes `subscribe` / `getState` — the shape React's `useSyncExternalStore`
 * consumes. Nothing here imports React or touches the DOM.
 */
export interface CatalogStore {
  getState(): CatalogState;
  subscribe(listener: () => void): () => void;
  /** Never rejects — a failure lands in `getState().status`. */
  refresh(force?: boolean): Promise<void>;
  /** Rejects with the API client's `ApiError`. */
  createCustom(input: CreateExercise): Promise<Exercise>;
  recordPick(id: string): void;
}

export interface CatalogStoreDeps {
  api: Pick<ApiClient, "request" | "post">;
  storage: StorageAdapter;
  userId: string;
  /** Defaults to `Date.now`; tests inject a clock. */
  now?: () => number;
}

const StoredCatalogSchema = z.object({
  version: z.literal(1),
  rows: z.array(ExerciseSchema),
  syncToken: z.string().nullable(),
});

const StoredRecentsSchema = z.object({
  version: z.literal(1),
  ids: z.array(z.string()).max(MAX_RECENTS),
});

type SyncResult =
  | { kind: "ok"; exercises: Exercise[]; syncToken: string }
  | SyncFailure;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function createCatalogStore(deps: CatalogStoreDeps): CatalogStore {
  const { api, storage, userId, now = Date.now } = deps;
  const CATALOG_KEY = catalogKey(userId);
  const RECENTS_KEY = recentsKey(userId);
  const listeners = new Set<() => void>();

  // AC11 — after the first storage failure the store stops touching storage
  // and runs from memory for the rest of its life, reporting exactly once.
  let storageFailed = false;
  function guarded<T>(operation: () => T, fallback: T): T {
    if (storageFailed) return fallback;
    try {
      return operation();
    } catch (error) {
      storageFailed = true;
      reportError(error, { source: "catalog-storage" });
      return fallback;
    }
  }

  // AC13 — another user's data left by a logout that could not run, or an
  // orphaned older-version key.
  guarded(() => {
    for (const key of storage.keys()) {
      if (isUserDataKey(key) && key !== CATALOG_KEY && key !== RECENTS_KEY) {
        storage.remove(key);
      }
    }
  }, undefined);

  function loadCatalog(): { rows: Exercise[]; syncToken: string | null } {
    const raw = guarded(() => storage.get(CATALOG_KEY), null);
    if (raw === null) return { rows: [], syncToken: null };
    const parsed = StoredCatalogSchema.safeParse(parseJson(raw));
    if (parsed.success) {
      return { rows: parsed.data.rows, syncToken: parsed.data.syncToken };
    }
    // AC10 — corrupt or hand-edited: discard; the next refresh is a full pull.
    guarded(() => storage.remove(CATALOG_KEY), undefined);
    track("catalog_reset", { reason: "corrupt" });
    return { rows: [], syncToken: null };
  }

  function loadRecents(): string[] {
    const raw = guarded(() => storage.get(RECENTS_KEY), null);
    if (raw === null) return [];
    const parsed = StoredRecentsSchema.safeParse(parseJson(raw));
    if (parsed.success) return parsed.data.ids;
    guarded(() => storage.remove(RECENTS_KEY), undefined);
    return [];
  }

  const loaded = loadCatalog();
  let state: CatalogState = {
    rows: loaded.rows,
    recentIds: loadRecents(),
    syncToken: loaded.syncToken,
    status: "idle",
    lastRefreshAt: null,
  };

  // AC22 — always a new object, so a snapshot comparison sees the change.
  function setState(patch: Partial<CatalogState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function persistCatalog(): void {
    guarded(() => {
      storage.set(
        CATALOG_KEY,
        JSON.stringify({ version: 1, rows: state.rows, syncToken: state.syncToken }),
      );
    }, undefined);
  }

  function persistRecents(): void {
    guarded(() => {
      storage.set(RECENTS_KEY, JSON.stringify({ version: 1, ids: state.recentIds }));
    }, undefined);
  }

  // AC15 — the token goes in `since`; `no-store` keeps the browser HTTP cache
  // out of every sync, so the stale-body loop Spec 03.3 §3 describes cannot
  // happen.
  async function syncOnce(since: string | null): Promise<SyncResult> {
    const path =
      since === null
        ? "/v1/exercises"
        : `/v1/exercises?since=${encodeURIComponent(since)}`;
    let body: unknown;
    try {
      body = await api.request(path, { cache: "no-store" });
    } catch (error) {
      return classifySyncFailure(error);
    }
    const parsed = ExercisesResponse.safeParse(body);
    if (!parsed.success) {
      // AC19 — a body we cannot trust is treated as a failed refresh.
      reportError(parsed.error, { source: "catalog-sync-schema" });
      return { kind: "transient" };
    }
    return {
      kind: "ok",
      exercises: parsed.data.exercises,
      syncToken: parsed.data.syncToken,
    };
  }

  async function runOnce(): Promise<void> {
    setState({ status: "loading" });
    const since = state.syncToken;
    let result = await syncOnce(since);
    let replace = since === null;

    if (result.kind === "reset") {
      // AC18 — one event, one full pull, old rows stay until it lands.
      track("catalog_reset", { reason: result.reason });
      result = await syncOnce(null);
      replace = true;
      if (result.kind !== "ok") {
        // Drop the unusable token so the next refresh is a plain full pull.
        setState({ syncToken: null, status: "error" });
        persistCatalog();
        return;
      }
    }

    if (result.kind === "ok") {
      // AC17 — a delta merges; a full pull replaces. `state.rows` is read
      // here, not before the await, so a row `createCustom` inserted while
      // the request was in flight survives a merge.
      setState({
        rows: mergeCatalogRows(replace ? [] : state.rows, result.exercises),
        syncToken: result.syncToken,
        status: "idle",
        lastRefreshAt: now(),
      });
      persistCatalog();
      return;
    }

    // AC19 — transient: keep everything, flag the failure.
    setState({ status: "error" });
  }

  let inFlight: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  function start(): Promise<void> {
    const run: Promise<void> = runOnce().finally(() => {
      if (inFlight === run) inFlight = null;
    });
    inFlight = run;
    return run;
  }

  function isFresh(): boolean {
    if (state.lastRefreshAt === null) return false;
    const elapsed = now() - state.lastRefreshAt;
    // A negative elapsed time means the clock moved backwards: not fresh.
    return elapsed >= 0 && elapsed < CATALOG_REFRESH_STALE_MS;
  }

  // AC14, AC16
  function refresh(force = false): Promise<void> {
    if (force && followUp) return followUp;
    if (inFlight) {
      if (!force) return inFlight;
      // The in-flight request may predate the write that asked for this, so
      // queue exactly one more run behind it.
      followUp = inFlight.then(() => {
        followUp = null;
        return start();
      });
      return followUp;
    }
    if (!force && isFresh()) return Promise.resolve();
    return start();
  }

  // AC21
  function recordPick(id: string): void {
    const recentIds = [id, ...state.recentIds.filter((other) => other !== id)].slice(
      0,
      MAX_RECENTS,
    );
    setState({ recentIds });
    persistRecents();
  }

  // AC23
  async function createCustom(input: CreateExercise): Promise<Exercise> {
    const created = await api.post<Exercise>("/v1/exercises", input, ExerciseSchema);
    setState({ rows: mergeCatalogRows(state.rows, [created]) });
    persistCatalog();
    recordPick(created.id);
    track("custom_exercise_created");
    // Not awaited: the caller has its row already; this lets the sync token
    // catch up with the write.
    void refresh(true);
    return created;
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    createCustom,
    recordPick,
  };
}
