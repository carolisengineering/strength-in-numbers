import { timedGroupRange, type SessionSlot, type WorkoutDetail } from "@sin/core";
import { sectionSegments } from "../sectionSegments";
import { supersetRows } from "../supersetRows";

/** Spec 10.7 §6.4: what made a section's grouping worth checking — it became timed (or changed format), or one exercise came in. */
export type GroupTrigger = "fill" | { readonly join: string };

export interface TimedRegroupTarget {
  /** The segment's slots, as `useRegroup.run` takes them. */
  readonly slots: SessionSlot[];
  /** The segment's first row in the workout, `run`'s `positionOffset`. */
  readonly start: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Spec 10.7 AC22 — which runs to group in a workout, read from the server's detail. Each segment of the section
 * (a split section is decided per segment, 09.2 §6.5) is fed to `@sin/core`'s `timedGroupRange`; a join looks only
 * at the segment holding the joined exercise. Nothing for an untimed or missing section. Pure.
 */
export function timedRegroupTargets(detail: WorkoutDetail, sectionId: string, trigger: GroupTrigger): TimedRegroupTarget[] {
  const section = detail.sections.find((s) => s.id === sectionId);
  if (section === undefined || section.timer === null) return [];
  const targets: TimedRegroupTarget[] = [];
  for (const segment of sectionSegments(supersetRows(detail.exercises), detail.sections)) {
    if (segment.sectionId !== sectionId) continue;
    if (trigger !== "fill" && !segment.rows.some((r) => r.exercise.id === trigger.join)) continue;
    const slots = segment.rows.map((r) => ({ id: r.exercise.id, group: r.exercise.supersetGroup }));
    const range = timedGroupRange(slots, trigger);
    if (range !== null) targets.push({ slots, start: segment.start, from: range.from, to: range.to });
  }
  return targets;
}
