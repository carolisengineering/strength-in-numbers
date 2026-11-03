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
 * Spec 10.7 AC23 — Try again after a regroup that failed part-way. The PATCHes go one at a time, so a failure can
 * leave the first members of the span grouped and the rest loose, and `timedGroupRange("fill")` then sees "already
 * grouped" and would do nothing. When `ids` (the span that was being grouped) are still contiguous in one of the
 * section's segments and every group among them lies wholly inside the span (what a partial write leaves), the span
 * is resumed; `"done"` when it is already one run; `null` when the screen changed shape since, and the caller decides
 * afresh from the current detail. Pure.
 */
export function resumeTarget(detail: WorkoutDetail, sectionId: string, ids: readonly string[]): TimedRegroupTarget | "done" | null {
  if (ids.length < 2) return null;
  for (const segment of sectionSegments(supersetRows(detail.exercises), detail.sections)) {
    if (segment.sectionId !== sectionId) continue;
    const slots = segment.rows.map((r) => ({ id: r.exercise.id, group: r.exercise.supersetGroup }));
    const from = slots.findIndex((s) => s.id === ids[0]);
    if (from < 0) continue;
    const to = from + ids.length - 1;
    if (to >= slots.length || ids.some((id, k) => slots[from + k]!.id !== id)) return null;
    const span = slots.slice(from, to + 1);
    const labels = new Set(span.flatMap((s) => (s.group === null ? [] : [s.group])));
    const outside = slots.filter((_, k) => k < from || k > to);
    if ([...labels].some((label) => outside.some((s) => s.group === label))) return null;
    if (labels.size === 1 && span.every((s) => s.group !== null)) return "done";
    return { slots, start: segment.start, from, to };
  }
  return null;
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
