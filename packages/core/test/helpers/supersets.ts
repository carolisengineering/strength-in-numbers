import type { SessionPatch, SessionSlot } from "../../src/supersets.js";

const IDS = "abcdefghijklmnopqrstuvwxyz";
/** Slots with ids a, b, c … and the given groups. */
export const s = (...groups: (number | null)[]): SessionSlot[] => groups.map((group, i) => ({ id: IDS[i]!, group }));

/** Group patches set `group`; a position patch removes the slot and re-inserts it at that index (AC10). */
export function applyPatches(current: readonly SessionSlot[], patches: readonly SessionPatch[]): SessionSlot[] {
  const out = current.map((x) => ({ ...x }));
  for (const p of patches) {
    const i = out.findIndex((x) => x.id === p.id);
    if ("position" in p) {
      const [slot] = out.splice(i, 1);
      out.splice(p.position, 0, slot!);
    } else {
      out[i] = { ...out[i]!, group: p.supersetGroup };
    }
  }
  return out;
}

/** Every non-null number occupies one contiguous stretch. */
export function contiguous(groups: readonly (number | null)[]): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (g === null || (i > 0 && groups[i - 1] === g)) continue;
    if (seen.has(g)) return false;
    seen.add(g);
  }
  return true;
}
