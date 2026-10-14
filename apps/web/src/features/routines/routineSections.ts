import type { Routine, RoutineItem, RoutineSection } from "@sin/core";

export interface RoutineGroup {
  readonly section: RoutineSection | null;
  readonly items: readonly RoutineItem[];
}

/**
 * The preview's grouping (Spec 10.3 AC20): the loose items first (always, for a routine with no sections), then one
 * group per section in position order. The server guarantees this order for a routine; an item naming an unknown
 * section reads as loose.
 */
export function routineGroups(routine: Routine): RoutineGroup[] {
  const items = [...routine.items].sort((a, b) => a.position - b.position);
  const sections = [...routine.sections].sort((a, b) => a.position - b.position);
  const known = new Set(sections.map((s) => s.id as string));
  const loose = items.filter((i) => i.sectionId === null || !known.has(i.sectionId));
  return [
    ...(loose.length > 0 || sections.length === 0 ? [{ section: null, items: loose }] : []),
    ...sections.map((section) => ({ section, items: items.filter((i) => i.sectionId === section.id) })),
  ];
}
