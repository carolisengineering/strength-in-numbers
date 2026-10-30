import {
  buildHevyWorkout,
  HevyLinkBeginSchema,
  HevyLinkStateSchema,
  type HevyLinkBegin,
  type HevyMapping,
  type HevyPostWorkout,
  type UnmappedExercise,
  type WorkoutDetail,
} from "@sin/core";

import { ApiError } from "../../../api";
import type { ApiClient } from "../../../api/client";
import type { HevyClient } from "../client/hevyClient";
import { HevyError, type HevyErrorKind } from "../client/hevyErrors";
import { findHevyCopy } from "./findHevyCopy";
import { HEVY_SEND_COPY, type SendNotice } from "./messages";

/**
 * Spec 20.2 AC4–AC12, §6.2: one send or update of a finished workout — read and build, begin (the claim), the Hevy
 * write, complete (record the Hevy id). The claim is released only on a definite failure; an ambiguous one keeps it
 * and offers a check. No Hevy write is ever retried by itself; only `complete` (a SIN call) is, three times.
 * React-free; never throws.
 *
 * D22 hold (minors 139, 144): the fingerprint is the begin's, sent back untouched and kept only in the outcome
 * (mutation state), so a server-held fingerprint or a claim token would change one call and the `retry-complete`
 * intent, and nothing else.
 */

/** §6.2: the waits before re-sending `complete` after a network failure, a `5xx` or a `429`. */
export const COMPLETE_RETRY_WAITS_MS = Object.freeze([1000, 2000, 4000] as const);

/**
 * What the user asked for. The ones after an ambiguous failure carry the begin's fingerprint (and the Hevy id for an
 * update) instead of beginning again: the claim they hold is still fresh, so a second begin would be refused.
 */
export type SendIntent =
  | { kind: "send" }
  | { kind: "update" }
  | { kind: "relink" }
  | { kind: "check"; fingerprint: string }
  | { kind: "send-anyway"; fingerprint: string }
  | { kind: "retry-update"; hevyWorkoutId: string; fingerprint: string }
  | { kind: "retry-complete"; hevyWorkoutId: string; fingerprint: string };

export type RefusedSlug = "hevy-workout-not-finished" | "hevy-no-claim";

export type SendOutcome =
  | { kind: "done"; foundExisting: boolean; notices: SendNotice[] }
  | { kind: "needs-pairing"; unmapped: UnmappedExercise[] }
  | { kind: "in-progress" }
  | { kind: "unsure"; op: "post" | "put"; fingerprint: string; hevyWorkoutId: string | null }
  | { kind: "inconclusive"; fingerprint: string }
  | { kind: "unrecorded"; hevyWorkoutId: string; fingerprint: string }
  | { kind: "already-linked" }
  | { kind: "copy-gone" }
  | { kind: "not-sent" }
  | { kind: "refused"; slug: RefusedSlug }
  | { kind: "gone" }
  /** D6 / owner answer Q5: a create-only send (auto-push) met a workout already in Hevy and wrote nothing. */
  | { kind: "skipped"; reason: "already_sent" }
  | { kind: "failed"; reason: HevyErrorKind | "server" | "unknown" };

export type SendReportOp = "begin" | "hevy-post" | "hevy-put" | "complete" | "release" | "find-copy";

export interface SendDeps {
  workoutId: string;
  getDetail(): Promise<WorkoutDetail>;
  getMapping(): Promise<HevyMapping>;
  rootOf(exerciseId: string): string;
  hevy: Pick<HevyClient, "createWorkout" | "updateWorkout" | "listWorkouts">;
  api: Pick<ApiClient, "post" | "request" | "delete">;
  sleep(ms: number): Promise<void>;
  report(op: SendReportOp, error: unknown): void;
  /** AC13 / D2: the exercises left out of this send. */
  leaveOut?: ReadonlySet<string>;
  /** D6 / owner answer Q5: never update an existing copy; release and stop instead. */
  createOnly?: boolean;
}

const SLUG_SENTENCES: Readonly<Record<string, string>> = {
  "hevy-send-in-progress": HEVY_SEND_COPY.inProgress,
  "hevy-workout-not-finished": HEVY_SEND_COPY.notFinished,
  "hevy-no-claim": HEVY_SEND_COPY.noClaim,
  "hevy-link-conflict": HEVY_SEND_COPY.alreadyLinked,
  "hevy-id-in-use": HEVY_SEND_COPY.alreadyLinked,
};

/** AC19: the static sentence for a begin / complete problem slug, or `null` for an unknown one. */
export function problemSentence(slug: string): string | null {
  return SLUG_SENTENCES[slug] ?? null;
}

const linkPath = (id: string) => `/v1/workouts/${id}/hevy-link`;
const isNetwork = (e: unknown) => e instanceof ApiError && e.isNetworkError;
const is4xx = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;
const slugIs = (e: unknown, status: number, slug: string) => e instanceof ApiError && e.status === status && e.type === slug;
/**
 * AC20: only failures that are not the network and not a `4xx` are reported — a Hevy `5xx` or an unreadable Hevy
 * reply (whatever its status), a SIN `5xx`, or anything unexpected.
 */
function reportable(e: unknown): boolean {
  if (e instanceof HevyError) return e.kind === "server" || e.kind === "unexpected_reply";
  return !isNetwork(e) && !is4xx(e);
}

/** AC8 (and owner answer Q2): Hevy refused without writing — release the claim. */
const DEFINITE: ReadonlySet<HevyErrorKind> = new Set(["rejected", "limit", "bad_key", "rate_limited"]);

interface Built {
  body: HevyPostWorkout;
  notices: SendNotice[];
}

export async function runSend(intent: SendIntent, deps: SendDeps): Promise<SendOutcome> {
  if (intent.kind === "retry-complete") return complete(deps, intent.hevyWorkoutId, intent.fingerprint, false, []);

  // 1. Build, from the detail and the mapping as they are now (AC4 a–b, AC16).
  let built: Built;
  try {
    const result = await build(deps);
    if ("unmapped" in result) return { kind: "needs-pairing", unmapped: result.unmapped };
    built = result;
  } catch (err) {
    // A workout deleted meanwhile is gone; a SIN 5xx on the reads is reported with the step that needed them.
    if (err instanceof ApiError && err.status === 404) return { kind: "gone" };
    if (isNetwork(err)) return { kind: "failed", reason: "network" };
    if (reportable(err)) deps.report("begin", err);
    return { kind: "failed", reason: err instanceof ApiError && err.status >= 500 ? "server" : "unknown" };
  }

  // After an ambiguous failure the claim is still held: carry on from it without a second begin.
  if (intent.kind === "check") return check(deps, built, intent.fingerprint);
  if (intent.kind === "send-anyway") return write(deps, built, { mode: "create", hevyWorkoutId: null, fingerprint: intent.fingerprint });
  if (intent.kind === "retry-update") return write(deps, built, { mode: "update", hevyWorkoutId: intent.hevyWorkoutId, fingerprint: intent.fingerprint });

  // 2. Begin: the claim (AC4 c).
  let begin: HevyLinkBegin;
  try {
    begin = await deps.api.post(linkPath(deps.workoutId), intent.kind === "relink" ? { relink: true } : undefined, HevyLinkBeginSchema);
  } catch (err) {
    if (slugIs(err, 409, "hevy-send-in-progress")) return { kind: "in-progress" };
    if (slugIs(err, 409, "hevy-workout-not-finished")) return { kind: "refused", slug: "hevy-workout-not-finished" };
    if (err instanceof ApiError && err.status === 404) return { kind: "gone" };
    if (isNetwork(err)) return { kind: "failed", reason: "network" };
    if (reportable(err)) deps.report("begin", err);
    // Owner answer Q3: a SIN 429 made no claim; the generic sentence.
    return { kind: "failed", reason: err instanceof ApiError && err.status >= 500 ? "server" : "unknown" };
  }

  if (deps.createOnly && begin.mode === "update") {
    await release(deps);
    return { kind: "skipped", reason: "already_sent" };
  }

  // 3. An interrupted earlier send may have reached Hevy: look before writing (AC7). Only a create can duplicate —
  // whatever was tapped (an Update can meet a stale claim-only row); a relink means the old copy is gone.
  if (begin.mode === "create" && begin.staleClaim && intent.kind !== "relink") return check(deps, built, begin.fingerprint, true);

  return write(deps, built, { mode: begin.mode, hevyWorkoutId: begin.hevyWorkoutId, fingerprint: begin.fingerprint });
}

async function build(deps: SendDeps): Promise<Built | { unmapped: UnmappedExercise[] }> {
  const [detail, mapping] = await Promise.all([deps.getDetail(), deps.getMapping()]);
  const leave = deps.leaveOut ?? new Set<string>();
  const kept: WorkoutDetail = { ...detail, exercises: detail.exercises.filter((e) => !leave.has(e.exerciseId)) };
  const result = buildHevyWorkout(kept, mapping, { rootOf: deps.rootOf });
  if (!result.ok) return { unmapped: result.unmapped };
  // D2: one notice per exercise left out, named as the workout recorded it.
  const leftOut = new Map<string, string>();
  for (const e of detail.exercises) if (leave.has(e.exerciseId) && !leftOut.has(e.exerciseId)) leftOut.set(e.exerciseId, e.exerciseNameSnapshot);
  return { body: result.body, notices: [...result.notices, ...[...leftOut.values()].map((name) => ({ code: "left_out" as const, name }))] };
}

/**
 * AC7 / AC9: look for the copy. Found → complete with its id. Conclusively not there → a send goes on to write
 * (`sendIfAbsent`); a Check releases the claim and reports "not sent yet". Inconclusive, or Hevy failing → keep the
 * claim and ask.
 */
async function check(deps: SendDeps, built: Built, fingerprint: string, sendIfAbsent = false): Promise<SendOutcome> {
  let found: Awaited<ReturnType<typeof findHevyCopy>>;
  try {
    found = await findHevyCopy(deps.hevy, { startTime: built.body.workout.start_time, title: built.body.workout.title });
  } catch (err) {
    if (reportable(err)) deps.report("find-copy", err);
    return { kind: "inconclusive", fingerprint };
  }
  if (found.kind === "found") return complete(deps, found.hevyWorkoutId, fingerprint, true, built.notices);
  if (found.kind === "inconclusive") return { kind: "inconclusive", fingerprint };
  if (sendIfAbsent) return write(deps, built, { mode: "create", hevyWorkoutId: null, fingerprint });
  await release(deps);
  return { kind: "not-sent" };
}

/** AC4 d–e / AC11: the one Hevy write. Never retried here. */
async function write(
  deps: SendDeps,
  built: Built,
  claim: { mode: "create" | "update"; hevyWorkoutId: string | null; fingerprint: string },
): Promise<SendOutcome> {
  const update = claim.mode === "update" && claim.hevyWorkoutId !== null;
  let hevyWorkoutId: string;
  try {
    const reply = update ? await deps.hevy.updateWorkout(claim.hevyWorkoutId!, built.body) : await deps.hevy.createWorkout(built.body);
    hevyWorkoutId = reply.id;
  } catch (err) {
    const op = update ? "put" : "post";
    if (err instanceof HevyError) {
      // AC12: the copy was deleted in Hevy.
      if (update && err.kind === "not_found") {
        await release(deps);
        return { kind: "copy-gone" };
      }
      // AC8, owner answer Q2 (a 404 on a create is definite too).
      if (DEFINITE.has(err.kind) || err.kind === "not_found") {
        await release(deps);
        return { kind: "failed", reason: err.kind };
      }
    }
    // AC9: network, a 5xx, an unreadable reply — Hevy may have written it. Keep the claim.
    if (reportable(err)) deps.report(update ? "hevy-put" : "hevy-post", err);
    return { kind: "unsure", op, fingerprint: claim.fingerprint, hevyWorkoutId: update ? claim.hevyWorkoutId : null };
  }
  return complete(deps, hevyWorkoutId, claim.fingerprint, false, built.notices);
}

/** AC4 f / AC10: record the Hevy id. Retried on the network, a `5xx` or a `429` (owner answer Q3). */
async function complete(deps: SendDeps, hevyWorkoutId: string, fingerprint: string, foundExisting: boolean, notices: SendNotice[]): Promise<SendOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.api.request(linkPath(deps.workoutId), { method: "PUT", body: { hevyWorkoutId, fingerprint }, schema: HevyLinkStateSchema });
      return { kind: "done", foundExisting, notices };
    } catch (err) {
      if (slugIs(err, 409, "hevy-id-in-use") || slugIs(err, 409, "hevy-link-conflict")) return { kind: "already-linked" };
      if (slugIs(err, 409, "hevy-no-claim")) return { kind: "refused", slug: "hevy-no-claim" };
      if (err instanceof ApiError && err.status === 404) return { kind: "gone" };
      const retryable = err instanceof ApiError && (err.isNetworkError || err.status >= 500 || err.status === 429);
      if (!retryable) {
        // Hevy has the copy; only the record failed. Say so (and offer Try again), never "couldn't send".
        if (reportable(err)) deps.report("complete", err);
        return { kind: "unrecorded", hevyWorkoutId, fingerprint };
      }
      if (attempt >= COMPLETE_RETRY_WAITS_MS.length) {
        if (reportable(err)) deps.report("complete", err);
        return { kind: "unrecorded", hevyWorkoutId, fingerprint };
      }
      await deps.sleep(COMPLETE_RETRY_WAITS_MS[attempt]!);
    }
  }
}

/** Clears the claim; a failure is reported (by the AC20 rule) and swallowed — the outcome is what caused it. */
async function release(deps: SendDeps): Promise<void> {
  try {
    await deps.api.delete(linkPath(deps.workoutId));
  } catch (err) {
    if (reportable(err)) deps.report("release", err);
  }
}
