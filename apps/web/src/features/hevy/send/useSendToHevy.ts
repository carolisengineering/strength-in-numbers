import { useIsMutating, useMutation, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { lineageRootId } from "@sin/core";

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
import { runSend, type SendIntent, type SendOutcome } from "./runSend";

/**
 * Spec 20.2 AC5: the one send per workout — a TanStack mutation keyed `["hevy","send",id]` plus a module-level
 * in-flight map, so a double tap, a second mounted section (or Phase B's auto-push) attaches to the run already going
 * instead of starting another. The run lives here, not in a component: leaving the screen mid-send still reaches
 * `complete`, and `onSettled` (a mutation option, so it runs after an unmount) refreshes the link.
 */

export interface SendVariables {
  intent: SendIntent;
  leaveOut?: ReadonlySet<string>;
  /** D6 / owner answer Q5: never update an existing copy (Phase B's auto-push). */
  createOnly?: boolean;
}

export interface SendContext {
  api: ApiClient;
  hevy: HevyClient | null;
  workouts: WorkoutClient;
  catalog: CatalogStore;
}

/** One promise per workout while a send runs (AC5). */
const inFlight = new Map<string, Promise<SendOutcome>>();

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
}

/** The mutation's options, shared with Phase B's runner: the deps, the run, and the refresh when it settles. */
export function sendMutationOptions(queryClient: QueryClient, ctx: SendContext, workoutId: string) {
  return {
    mutationKey: HEVY_SEND_KEYS.send(workoutId),
    networkMode: "always" as const,
    retry: false,
    mutationFn: async ({ intent, leaveOut, createOnly }: SendVariables): Promise<SendOutcome> => {
      // AC3 guard: the section never offers a button without a key.
      if (ctx.hevy === null) return { kind: "failed", reason: "bad_key" };
      // The rows as they are at the tap (not a subscription); an unknown exercise is its own root.
      const roots = new Map<string, string>(ctx.catalog.getState().rows.map((row) => [row.id, lineageRootId(row)]));
      return runSend(intent, {
        workoutId,
        // AC16: both reads fail at once offline (`networkMode: "always"`), never paused and sent later.
        getDetail: () =>
          queryClient.fetchQuery({ queryKey: WORKOUT_KEYS.detail(workoutId), queryFn: () => ctx.workouts.getById(workoutId), staleTime: 0, retry: false, networkMode: "always" }),
        getMapping: () => queryClient.fetchQuery({ ...hevyMappingQuery(ctx.api), networkMode: "always" }),
        rootOf: (id) => roots.get(id) ?? id,
        hevy: ctx.hevy,
        api: ctx.api,
        sleep: (ms) => sendSleep(ms),
        report: (op, error) => reportError(error, { source: "hevy-send", op }),
        ...(leaveOut ? { leaveOut } : {}),
        ...(createOnly ? { createOnly } : {}),
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: HEVY_SEND_KEYS.link(workoutId) }),
        // The status carries `linkCount`.
        queryClient.invalidateQueries({ queryKey: HEVY_KEYS.statusAll }),
      ]);
    },
  };
}

export function useSendToHevy(workoutId: string): {
  run(intent: SendIntent, opts?: { leaveOut?: ReadonlySet<string>; createOnly?: boolean }): Promise<SendOutcome>;
  pending: boolean;
  last: SendOutcome | null;
} {
  const queryClient = useQueryClient();
  const api = useApi();
  const hevy = useHevyClient();
  const workouts = useWorkoutClient();
  const catalog = useCatalogStore();
  const { mutateAsync } = useMutation(sendMutationOptions(queryClient, { api, hevy, workouts, catalog }, workoutId));
  const mutationKey = HEVY_SEND_KEYS.send(workoutId);
  const pending = useIsMutating({ mutationKey }) > 0;
  const outcomes = useMutationState({ filters: { mutationKey, status: "success" }, select: (m) => m.state.data as SendOutcome });
  const run = useCallback(
    (intent: SendIntent, opts: { leaveOut?: ReadonlySet<string>; createOnly?: boolean } = {}) => joinOrStart(workoutId, () => mutateAsync({ intent, ...opts })),
    [workoutId, mutateAsync],
  );
  return { run, pending, last: outcomes.at(-1) ?? null };
}
