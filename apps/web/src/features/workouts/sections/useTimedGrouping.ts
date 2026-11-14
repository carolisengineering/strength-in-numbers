import { useEffect, useRef } from "react";
import type { WorkoutDetail } from "@sin/core";
import type { Regroup } from "../useRegroup";
import { SECTION_COPY } from "./sectionCopy";
import { resumeTarget, timedRegroupTargets, type GroupTrigger, type TimedRegroupTarget } from "./timedGrouping";
import type { SectionBanner } from "./useSectionActions";

/** What the lifter just did, for the failure banner's wording (AC23). */
export type GroupCause = "timer" | "added" | "moved";

const GROUP_FAILED: Readonly<Record<GroupCause, string>> = {
  timer: SECTION_COPY.groupFailedTimer,
  added: SECTION_COPY.groupFailedAdded,
  moved: SECTION_COPY.groupFailedMoved,
};

export interface TimedGroupingDeps {
  /** The screen's own `useRegroup` (online-only; the edit screen's re-reads its detail and emits `exercise_regrouped`). */
  regroup: Regroup;
  /**
   * Re-read the workout before a Try again plans (minor 321: another device may have linked the exercises since);
   * false if the read failed or the device is offline. The screens pass `rereadFresh` on their own query key.
   */
  reread(): Promise<boolean>;
  /** The workout as the cache holds it now (the structure write has re-read it). */
  readDetail(): WorkoutDetail | null | undefined;
  setBanner(banner: SectionBanner | null): void;
  structureLock: { current: boolean };
}

export interface TimedGrouping {
  /** Group what §6.4 says to, from the current detail. The caller already holds `structureLock`. */
  couple(sectionId: string, trigger: GroupTrigger, cause: GroupCause): Promise<void>;
}

interface Attempt {
  readonly sectionId: string;
  readonly trigger: GroupTrigger;
  readonly cause: GroupCause;
}

/**
 * Spec 10.7 AC22–AC23 — a timed section's grouping as a second online step after a structure write. Each target
 * goes through the screen's `useRegroup.run` with the `groupRange` op (minimal PATCHes, one at a time). A failure
 * never rolls the change back: it raises a banner whose Try again re-reads the workout (minor 321) and works from that
 * detail — it finishes a span that partly landed (`resumeTarget`), and otherwise recomputes, so a segment that is
 * already grouped sends nothing.
 */
export function useTimedGrouping(deps: TimedGroupingDeps): TimedGrouping {
  // The latest deps, so a Try again tapped later reads the screen as it is then.
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  // Built once: both functions read `latest` when called, so they never go stale and need no hook dependencies.
  const api = useRef<TimedGrouping | null>(null);
  if (api.current === null) {
    /** The failure banner, whose Try again resumes `span` (the one place its text and retry are made). */
    const failedBanner = (attempt: Attempt, span: readonly string[]): SectionBanner => ({
      tone: "error",
      text: GROUP_FAILED[attempt.cause],
      retry: () => void retry(attempt, span),
    });

    /** Send each target; on the first failure raise the banner, remembering the span that was being grouped. */
    const send = async (attempt: Attempt, targets: readonly TimedRegroupTarget[]): Promise<void> => {
      const { regroup, setBanner } = latest.current;
      for (const target of targets) {
        const outcome = await regroup.run(target.slots, { type: "groupRange", from: target.from, to: target.to }, { positionOffset: target.start });
        if (outcome.status === "refused") {
          setBanner({ tone: "warning", text: outcome.message });
          return;
        }
        if (outcome.status === "failed" || outcome.status === "busy") {
          const span = target.slots.slice(target.from, target.to + 1).map((s) => s.id);
          setBanner(failedBanner(attempt, span));
          return;
        }
      }
    };

    const couple = async (sectionId: string, trigger: GroupTrigger, cause: GroupCause): Promise<void> => {
      const detail = latest.current.readDetail();
      if (!detail) return;
      await send({ sectionId, trigger, cause }, timedRegroupTargets(detail, sectionId, trigger));
    };

    /** From the banner: takes the lock itself. */
    const retry = async (attempt: Attempt, span: readonly string[]): Promise<void> => {
      const { structureLock, setBanner, reread } = latest.current;
      if (structureLock.current) return;
      structureLock.current = true;
      setBanner(null);
      try {
        // Minor 321: plan from the server's workout, not the cache, so a link made on another device stays. A read that
        // fails (or can't start offline) sends nothing: the banner comes back with the same Try again.
        if (!(await reread())) {
          latest.current.setBanner(failedBanner(attempt, span));
          return;
        }
        const detail = latest.current.readDetail();
        if (!detail) return;
        const resumed = resumeTarget(detail, attempt.sectionId, span);
        if (resumed === "done") return;
        await send(attempt, resumed !== null ? [resumed] : timedRegroupTargets(detail, attempt.sectionId, attempt.trigger));
      } finally {
        structureLock.current = false;
      }
    };

    api.current = { couple };
  }
  return api.current;
}
