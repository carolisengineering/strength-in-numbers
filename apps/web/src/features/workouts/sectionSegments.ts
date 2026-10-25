import { groupBySection, type WorkoutSection } from "@sin/core";
import type { SupersetRow } from "./supersetRows";

export const OTHER_EXERCISES_HEADING = "Other exercises";

export interface SectionSegment {
  /** Stable React key within one render. */
  readonly key: string;
  /** `null` = render the rows with no heading (the first loose segment, or a workout with no sections). */
  readonly heading: string | null;
  /** The section's note; only under the section's FIRST segment, `null` otherwise. */
  readonly notes: string | null;
  readonly rows: readonly SupersetRow[];
  /** Spec 10.6 AC1: the real section this segment draws; `null` on loose segments ("Other exercises" included). */
  readonly sectionId: string | null;
  /** Spec 10.6 AC1: true only on a real section's FIRST segment — where its note shows and its Edit button goes. */
  readonly editable: boolean;
  /** Index in the position-ordered rows of this segment's first row — the offset of its absolute positions (AC26). */
  readonly start: number;
}

interface Draft {
  readonly section: WorkoutSection | null;
  readonly rows: readonly SupersetRow[];
  readonly start: number;
}

/**
 * Spec 10.3 AC11, D8. Every maximal run of rows with the same section is one segment (a workout's list may hold a
 * loose tail, or a section split in two — Spec 09.2 §6.5 — so the display is derived, never assumed). A section
 * with no rows becomes a heading-only segment, placed before the first segment that belongs to a later section
 * or is a trailing loose segment (else last). Pure.
 */
export function sectionSegments(rows: readonly SupersetRow[], sections: readonly WorkoutSection[]): SectionSegment[] {
  if (sections.length === 0) return [{ key: "loose-start-0", heading: null, notes: null, rows, start: 0, sectionId: null, editable: false }];
  const known = new Map(sections.map((s) => [s.id as string, s]));
  const sectionOf = (row: SupersetRow): string | null => (row.sectionId !== null && known.has(row.sectionId) ? row.sectionId : null);

  let start = 0;
  const list: Draft[] = groupBySection(rows, sectionOf).map((run) => {
    const draft: Draft = { section: run.sectionId === null ? null : known.get(run.sectionId)!, rows: run.items, start };
    start += run.items.length;
    return draft;
  });

  const present = new Set(list.flatMap((d) => (d.section ? [d.section.id as string] : [])));
  for (const section of [...sections].sort((a, b) => a.position - b.position)) {
    if (present.has(section.id)) continue;
    const trailingLoose = (d: Draft, at: number) => d.section === null && list.slice(0, at).some((x) => x.section !== null);
    const at = list.findIndex((d, i) => (d.section !== null && d.section.position > section.position) || trailingLoose(d, i));
    const empty: Draft = { section, rows: [], start: at < 0 ? rows.length : list[at]!.start };
    list.splice(at < 0 ? list.length : at, 0, empty);
    present.add(section.id);
  }

  // Keys come from content, never from the list index: a run that disappears (the lifter removes the only
  // loose-first exercise) must not renumber the others, or React remounts their cards and loses typed drafts.
  // The trailing loose run has one fixed key: adding a section puts its empty segment before the tail, which
  // must not remount those cards (#156, an open Options panel would close).
  const noted = new Map<string, number>();
  let lastSectionId: string | null = null;
  let lastOccurrence = 0;
  let looseRuns = 0;
  return list.map((d, index): SectionSegment => {
    if (d.section === null) {
      const tail = lastSectionId !== null && index === list.length - 1;
      const key =
        lastSectionId === null ? `loose-start-${looseRuns}` : tail ? "loose-tail" : `loose-after-${lastSectionId}-${lastOccurrence}-${looseRuns}`;
      looseRuns += 1;
      return { key, heading: lastSectionId === null ? null : OTHER_EXERCISES_HEADING, notes: null, rows: d.rows, start: d.start, sectionId: null, editable: false };
    }
    looseRuns = 0;
    const occurrence = noted.get(d.section.id) ?? 0;
    noted.set(d.section.id, occurrence + 1);
    lastSectionId = d.section.id;
    lastOccurrence = occurrence;
    return {
      key: `section-${d.section.id}-${occurrence}`,
      heading: d.section.name,
      notes: occurrence === 0 ? d.section.notes : null,
      rows: d.rows,
      start: d.start,
      sectionId: d.section.id,
      editable: occurrence === 0,
    };
  });
}
