import { cutCodePoints, ROUTINE_NAME_MAX, ROUTINES_PER_USER_MAX, type HevyFolder, type HevyRoutine } from "@sin/core";

/** Spec 20.1 AC7, §6.4: the routine checklist by Hevy folder, with the cap room. Pure. */

/** The name the server will compare: what `translateHevyRoutine` names the routine, lowercased (the `lower(name)` index). */
export function routineNameKey(name: string): string {
  let cleaned = "";
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) cleaned += name[i];
  }
  const trimmed = cleaned.trim();
  if (trimmed === "") return "hevy routine";
  return cutCodePoints(trimmed, ROUTINE_NAME_MAX).text.toLowerCase();
}

export interface RoutineGroup {
  folderId: number | null;
  title: string | null;
  routines: HevyRoutine[];
}

/** Folders in Hevy's `index` order, then "No folder" (also any routine whose folder wasn't read). Empty groups are left out. */
export function groupRoutines(folders: readonly HevyFolder[], routines: readonly HevyRoutine[]): RoutineGroup[] {
  const known = new Map(folders.map((f) => [f.id, f]));
  const byFolder = new Map<number | null, HevyRoutine[]>();
  for (const r of routines) {
    const key = r.folder_id !== null && known.has(r.folder_id) ? r.folder_id : null;
    const list = byFolder.get(key) ?? [];
    list.push(r);
    byFolder.set(key, list);
  }
  const ordered = [...folders].sort((a, b) => a.index - b.index || a.id - b.id);
  const groups: RoutineGroup[] = ordered.flatMap((f) => {
    const list = byFolder.get(f.id);
    return list ? [{ folderId: f.id, title: f.title, routines: list }] : [];
  });
  const loose = byFolder.get(null);
  if (loose) groups.push({ folderId: null, title: null, routines: loose });
  return groups;
}

export interface PickState {
  picked: ReadonlySet<string>;
}

export interface PickContext {
  picks: PickState;
  /** `routineNameKey` of every SIN routine. */
  existingNames: ReadonlySet<string>;
  /** How many routines SIN holds now (one-offs count: the cap counts rows). */
  routineCount: number;
  routinesById: ReadonlyMap<string, HevyRoutine>;
}

export type PickAvailability = "ok" | "exists" | "same_name_chosen" | "no_room";

export function room(routineCount: number, picks: PickState): number {
  return Math.max(0, ROUTINES_PER_USER_MAX - routineCount - picks.picked.size);
}

export function pickAvailability(routine: HevyRoutine, ctx: PickContext): PickAvailability {
  if (ctx.picks.picked.has(routine.id)) return "ok";
  const key = routineNameKey(routine.title);
  if (ctx.existingNames.has(key)) return "exists";
  for (const id of ctx.picks.picked) {
    const other = ctx.routinesById.get(id);
    if (other !== undefined && routineNameKey(other.title) === key) return "same_name_chosen";
  }
  if (room(ctx.routineCount, ctx.picks) === 0) return "no_room";
  return "ok";
}

/** Ticks or unticks; a routine that isn't available stays unticked (the same state comes back). */
export function toggle(picks: PickState, id: string, ctx: PickContext): PickState {
  if (picks.picked.has(id)) {
    const next = new Set(picks.picked);
    next.delete(id);
    return { picked: next };
  }
  const routine = ctx.routinesById.get(id);
  if (routine === undefined || pickAvailability(routine, { ...ctx, picks }) !== "ok") return picks;
  return { picked: new Set([...picks.picked, id]) };
}

/** **Tick all in this folder**: the available routines, in Hevy's order, up to the room. */
export function tickAllInFolder(picks: PickState, group: RoutineGroup, ctx: PickContext): PickState {
  let next = picks;
  for (const r of group.routines) {
    if (!next.picked.has(r.id)) next = toggle(next, r.id, { ...ctx, picks: next });
  }
  return next;
}
