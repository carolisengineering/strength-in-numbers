import { exerciseId } from "./catalogFixtures";
import type { Draft, DraftItem } from "../features/routines/routineDraft";

const TOKEN = /^([a-z]+)(\d*)$/;

function item(token: string, sectionKey: string | null, n: number): DraftItem {
  const m = TOKEN.exec(token)!;
  return {
    key: m[1]!,
    exerciseId: exerciseId(n + 1),
    targetSets: null,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetRpe: null,
    restSeconds: null,
    notes: null,
    supersetGroup: m[2] === "" ? null : Number(m[2]),
    weight: null,
    weightUnit: null,
    plan: null,
    sectionKey,
  };
}
const tokens = (spec: string) => spec.split(/\s+/).filter(Boolean);

/** `sectioned("a b1 b1", ["W", "c d"], ["M", ""])` — loose items first, then each [key, items] section. Names equal keys. */
export function sectioned(loose: string, ...sections: [key: string, items: string][]): Draft {
  let n = 0;
  const items = [
    ...tokens(loose).map((t) => item(t, null, n++)),
    ...sections.flatMap(([key, spec]) => tokens(spec).map((t) => item(t, key, n++))),
  ];
  return {
    name: "Push B",
    notes: "",
    sections: sections.map(([key]) => ({ key, name: key, notes: "" })),
    items,
    dirty: false,
    adjusted: false,
    unlinkNotice: false,
  };
}
export const shape = (d: Draft) => d.items.map((i) => `${i.sectionKey ?? "-"}:${i.key}${i.supersetGroup ?? ""}`).join(" ");
export const sectionNames = (d: Draft) => d.sections.map((s) => s.key).join(",");
