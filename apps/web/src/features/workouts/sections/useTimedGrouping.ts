import { useCallback, useEffect, useRef } from "react";
import type { WorkoutDetail } from "@sin/core";
import type { Regroup } from "../useRegroup";
import { SECTION_COPY } from "./sectionCopy";
import { timedRegroupTargets, type GroupTrigger } from "./timedGrouping";
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
  /** The workout as the cache holds it now (the structure write has re-read it). */
  readDetail(): WorkoutDetail | null | undefined;
  setBanner(banner: SectionBanner | null): void;
  structureLock: { current: boolean };
}

export interface TimedGrouping {
  /** Group what §6.4 says to, from the current detail. The caller already holds `structureLock`. */
  couple(sectionId: string, trigger: GroupTrigger, cause: GroupCause): Promise<void>;
}

/**
 * Spec 10.7 AC22–AC23 — a timed section's grouping as a second online step after a structure write. Each target
 * goes through the screen's `useRegroup.run` with the `groupRange` op (minimal PATCHes, one at a time). A failure
 * never rolls the change back: it raises a banner whose Try again recomputes from the then-current detail, so a
 * segment that is already grouped sends nothing.
 */
export function useTimedGrouping(deps: TimedGroupingDeps): TimedGrouping {
  // The latest deps, so a Try again tapped later reads the screen as it is then.
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  const couple = useCallback(async (sectionId: string, trigger: GroupTrigger, cause: GroupCause): Promise<void> => {
    const { regroup, readDetail, setBanner } = latest.current;
    const detail = readDetail();
    if (!detail) return;
    for (const target of timedRegroupTargets(detail, sectionId, trigger)) {
      const outcome = await regroup.run(target.slots, { type: "groupRange", from: target.from, to: target.to }, { positionOffset: target.start });
      if (outcome.status === "refused") {
        setBanner({ tone: "warning", text: outcome.message });
        return;
      }
      if (outcome.status === "failed" || outcome.status === "busy") {
        setBanner({ tone: "error", text: GROUP_FAILED[cause], retry: () => void retry(sectionId, trigger, cause) });
        return;
      }
    }
  }, []);

  const retry = useCallback(
    async (sectionId: string, trigger: GroupTrigger, cause: GroupCause): Promise<void> => {
      const { structureLock, setBanner } = latest.current;
      if (structureLock.current) return;
      structureLock.current = true;
      setBanner(null);
      try {
        await couple(sectionId, trigger, cause);
      } finally {
        structureLock.current = false;
      }
    },
    [couple],
  );

  return { couple };
}
