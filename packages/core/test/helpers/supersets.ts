import type { SessionSlot } from "../../src/supersets.js";

const IDS = "abcdefghijklmnopqrstuvwxyz";
/** Slots with ids a, b, c … and the given groups. */
export const s = (...groups: (number | null)[]): SessionSlot[] => groups.map((group, i) => ({ id: IDS[i]!, group }));
