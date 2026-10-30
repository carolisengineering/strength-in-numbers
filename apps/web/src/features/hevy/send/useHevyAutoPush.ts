import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { buildHevyWorkout, lineageRootId, type HevyStatus } from "@sin/core";

import type { ApiClient } from "../../../api/client";
import { useApi } from "../../../auth/useApi";
import { useSession } from "../../../auth/useSession";
import { isHevyAutoPushOn } from "../../../ui/hevyAutoPush";
import { useCatalogStore } from "../../catalog/CatalogProvider";
import type { CatalogStore } from "../../catalog/catalogStore";
import { onWorkoutFinished } from "../../workouts/finishEvents";
import { useWorkoutClient, WORKOUT_KEYS } from "../../workouts/queries";
import type { WorkoutClient } from "../../workouts/workoutClient";
import type { HevyClient } from "../client/hevyClient";
import { HEVY_KEYS } from "../keys";
import { hevyMappingQuery } from "../mapping/useHevyMapping";
import { useHevyClient } from "../useHevyClient";
import { hevyStatusQuery } from "../useHevyStatus";
import { hevyLinkQuery } from "./useHevyLink";
import { useSendRunner } from "./useSendToHevy";

/**
 * Spec 20.2 AC25–AC29: with "Send each workout to Hevy when I finish it" on, a finished workout is sent through the
 * button's own sequence (`useSendRunner`), create-only, once every exercise is matched. It is silent: every failed check
 * returns, the outcome is never read here (the workout's section shows it), and nothing waits, retries or is stored.
 * Mounted once, in `ProtectedLayout`.
 */

interface Current {
  queryClient: QueryClient;
  api: ApiClient;
  userId: string | null;
  hevy: HevyClient | null;
  workouts: WorkoutClient;
  catalog: CatalogStore;
  runner: ReturnType<typeof useSendRunner>;
}

/** Workouts whose checks are running, so a second listener (or a repeated event) reads nothing twice. */
const checking = new Set<string>();

/** Every read: no retry, and never paused offline to resume after the event. */
const once = { retry: false, networkMode: "always" } as const;

/** A cached success is enough; else read it (anyone but the owner gets a `404`, which rejects). */
async function ensureOwner(c: Current): Promise<void> {
  if (c.queryClient.getQueryData<HevyStatus>(HEVY_KEYS.status(c.userId)) !== undefined) return;
  await c.queryClient.fetchQuery({ ...hevyStatusQuery(c.api, c.userId), ...once });
}

/** AC25's checks, in order; true only if the workout should be sent now. A rejected read is a silent no. */
async function shouldSend(workoutId: string, read: () => Current): Promise<boolean> {
  // 1. First, so a non-owner (or the owner with it off) makes no request at all.
  if (!isHevyAutoPushOn()) return false;
  try {
    // 2. The owner gate.
    await ensureOwner(read());
    // 3. A key on this device.
    if (read().hevy === null) return false;
    // 4. Online: offline there is no begin, so no claim shows "Sending to Hevy…" for two minutes.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    const c = read();
    // 5. Fresh, and finished.
    const detail = await c.queryClient.fetchQuery({ queryKey: WORKOUT_KEYS.detail(workoutId), queryFn: () => c.workouts.getById(workoutId), staleTime: 0, ...once });
    if (detail.endedAt === null) return false;
    // 6–7. Every exercise matched (O1: an unmatched one waits for the button).
    const mapping = await c.queryClient.fetchQuery({ ...hevyMappingQuery(c.api), ...once });
    const roots = new Map<string, string>(c.catalog.getState().rows.map((row) => [row.id, lineageRootId(row)]));
    if (!buildHevyWorkout(detail, mapping, { rootOf: (id) => roots.get(id) ?? id }).ok) return false;
    // 8. Create only: never a workout already linked (or being sent).
    const link = await c.queryClient.fetchQuery({ ...hevyLinkQuery(c.api, workoutId), ...once });
    return link.state === "none";
  } catch {
    // The section shows server truth; a 404 here is a workout deleted right after the finish.
    return false;
  }
}

async function autoPush(workoutId: string, read: () => Current): Promise<void> {
  if (checking.has(workoutId)) return;
  checking.add(workoutId);
  try {
    if (!(await shouldSend(workoutId, read))) return;
    // D6 / owner answer Q5: if a send lands between the link read and this begin, the run releases instead of updating.
    void read().runner(workoutId, { kind: "send" }, { createOnly: true });
  } finally {
    checking.delete(workoutId);
  }
}

export function useHevyAutoPush(): void {
  const queryClient = useQueryClient();
  const api = useApi();
  const userId = useSession().user?.id ?? null;
  // `null` without a key; it follows the key store, other tabs included.
  const hevy = useHevyClient();
  const workouts = useWorkoutClient();
  const catalog = useCatalogStore();
  const runner = useSendRunner();
  const current = useRef<Current>({ queryClient, api, userId, hevy, workouts, catalog, runner });
  current.current = { queryClient, api, userId, hevy, workouts, catalog, runner };

  // Subscribed once; the listener reads today's values through the ref.
  useEffect(() => onWorkoutFinished(({ workoutId }) => void autoPush(workoutId, () => current.current)), []);
}

/** The element `ProtectedLayout` mounts. */
export function HevyAutoPush(): null {
  useHevyAutoPush();
  return null;
}

/** Test-only. */
export function resetAutoPushState(): void {
  checking.clear();
}
