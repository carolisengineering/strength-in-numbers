import { useIsMutating, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { HevyLinkState, HevyMapping, WorkoutDetail } from "@sin/core";

import type { ApiClient } from "../../../api/client";
import { useApi } from "../../../auth/useApi";
import { reportError } from "../../../observability/reportError";
import { useCatalogStore } from "../../catalog/CatalogProvider";
import type { CatalogStore } from "../../catalog/catalogStore";
import { useWorkoutClient, WORKOUT_KEYS } from "../../workouts/queries";
import type { WorkoutClient } from "../../workouts/workoutClient";
import type { HevyClient } from "../client/hevyClient";
import { HEVY_KEYS, HEVY_SEND_KEYS } from "../keys";
import { hevyMappingQuery } from "../mapping/useHevyMapping";
import { sleep } from "../sharedClient";
import { useHevyClient } from "../useHevyClient";
import { rootOfRows } from "./rootOf";
import { runSend, type SendIntent, type SendOutcome } from "./runSend";

/**
 * Spec 20.2 AC5: the one send per workout — a TanStack mutation keyed `["hevy","send",id]` plus a module-level
 * in-flight map, so a double tap, a second mounted section (or Phase B's auto-push) attaches to the run already going
 * instead of starting another. The run lives here, not in a component: leaving the screen mid-send still reaches
 * `complete`, and `onSettled` (a mutation option, so it runs after an unmount) refreshes the link.
 */

/** Minor 263: the detail and mapping a caller has just read fresh, for this run only (auto-push's check). */
export interface SendReads {
  detail: WorkoutDetail;
  mapping: HevyMapping;
}

export interface SendVariables {
  intent: SendIntent;
  leaveOut?: ReadonlySet<string>;
  /** D6 / owner answer Q5: never update an existing copy (Phase B's auto-push). */
  createOnly?: boolean;
  reads?: SendReads;
}

export interface SendContext {
  api: ApiClient;
  hevy: HevyClient | null;
  workouts: WorkoutClient;
  catalog: CatalogStore;
}

/** One promise per workout while a send runs (AC5). */
const inFlight = new Map<string, Promise<SendOutcome>>();

/**
 * The last run's outcome per workout, the link state it landed on (read after `onSettled`'s refresh) and the exercises
 * it left out. It outlives the screen (a revisit mid-send still sees "not sure"), and the section shows it only while
 * the link still reads that state.
 */
export interface Landed {
  outcome: SendOutcome;
  base: HevyLinkState["state"];
  leaveOut?: ReadonlySet<string>;
}
const landedBy = new Map<string, Landed>();

/** Joins the run already going for this workout, or starts one. */
export function joinOrStart(workoutId: string, start: () => Promise<SendOutcome>): Promise<SendOutcome> {
  const running = inFlight.get(workoutId);
  if (running) return running;
  const promise = start().finally(() => inFlight.delete(workoutId));
  inFlight.set(workoutId, promise);
  return promise;
}

/** Test-only: complete's retry waits (1 s, 2 s, 4 s in the app). */
let sendSleep: (ms: number) => Promise<void> = (ms) => sleep(ms);
export function setSendSleepForTests(fn: (ms: number) => Promise<void>): void {
  sendSleep = fn;
}

/** Test-only: a test that leaves a run hanging must not join the next test's. */
export function resetSendState(workoutId: string): void {
  inFlight.delete(workoutId);
  landedBy.delete(workoutId);
}

/** The mutation's options, shared with Phase B's runner: the deps, the run, and the refresh when it settles. */
export function sendMutationOptions(queryClient: QueryClient, ctx: SendContext, workoutId: string) {
  return {
    mutationKey: HEVY_SEND_KEYS.send(workoutId),
    networkMode: "always" as const,
    retry: false,
    mutationFn: async ({ intent, leaveOut, createOnly, reads }: SendVariables): Promise<SendOutcome> => {
      // AC3 guard: the section never offers a button without a key.
      if (ctx.hevy === null) return { kind: "failed", reason: "bad_key" };
      // The rows as they are at the tap (not a subscription).
      const rootOf = rootOfRows(ctx.catalog.getState().rows);
      return runSend(intent, {
        workoutId,
        // AC16: both reads fail at once offline (`networkMode: "always"`), never paused and sent later.
        getDetail: () =>
          reads
            ? Promise.resolve(reads.detail)
            : queryClient.fetchQuery({ queryKey: WORKOUT_KEYS.detail(workoutId), queryFn: () => ctx.workouts.getById(workoutId), staleTime: 0, retry: false, networkMode: "always" }),
        getMapping: () => (reads ? Promise.resolve(reads.mapping) : queryClient.fetchQuery({ ...hevyMappingQuery(ctx.api), networkMode: "always" })),
        rootOf,
        hevy: ctx.hevy,
        api: ctx.api,
        sleep: (ms) => sendSleep(ms),
        report: (op, error) => reportError(error, { source: "hevy-send", op }),
        ...(leaveOut ? { leaveOut } : {}),
        ...(createOnly ? { createOnly } : {}),
      });
    },
    onSettled: async (outcome: SendOutcome | undefined, _error: unknown, variables: SendVariables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: HEVY_SEND_KEYS.link(workoutId) }),
        // The status carries `linkCount`.
        queryClient.invalidateQueries({ queryKey: HEVY_KEYS.statusAll }),
      ]);
      const base = queryClient.getQueryData<HevyLinkState>(HEVY_SEND_KEYS.link(workoutId))?.state;
      if (outcome === undefined || base === undefined) landedBy.delete(workoutId);
      else landedBy.set(workoutId, { outcome, base, ...(variables.leaveOut ? { leaveOut: variables.leaveOut } : {}) });
    },
  };
}

export type SendRunOptions = { leaveOut?: ReadonlySet<string>; createOnly?: boolean; reads?: SendReads };

/**
 * Spec 20.2 Phase B: the send for any workout, made per call — the same options, deps, key and `onSettled` as the
 * button's mutation, so a run started here (auto-push) and one started by the section join one in-flight entry.
 */
export function useSendRunner(): (workoutId: string, intent: SendIntent, opts?: SendRunOptions) => Promise<SendOutcome> {
  const queryClient = useQueryClient();
  const api = useApi();
  const hevy = useHevyClient();
  const workouts = useWorkoutClient();
  const catalog = useCatalogStore();
  return useCallback(
    (workoutId: string, intent: SendIntent, opts: SendRunOptions = {}) =>
      joinOrStart(workoutId, () =>
        queryClient
          .getMutationCache()
          .build(queryClient, sendMutationOptions(queryClient, { api, hevy, workouts, catalog }, workoutId))
          .execute({ intent, ...opts }),
      ),
    [queryClient, api, hevy, workouts, catalog],
  );
}

export function useSendToHevy(workoutId: string): {
  run(intent: SendIntent, opts?: SendRunOptions): Promise<SendOutcome>;
  pending: boolean;
  landed: Landed | null;
} {
  const runner = useSendRunner();
  // `onSettled` records the outcome before the mutation stops counting as pending, so this re-render reads it.
  const pending = useIsMutating({ mutationKey: HEVY_SEND_KEYS.send(workoutId) }) > 0;
  const run = useCallback((intent: SendIntent, opts: SendRunOptions = {}) => runner(workoutId, intent, opts), [workoutId, runner]);
  return { run, pending, landed: landedBy.get(workoutId) ?? null };
}
