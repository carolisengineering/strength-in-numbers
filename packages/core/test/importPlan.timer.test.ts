import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RoutineWriteSchema } from "../src/dto/routine.js";
import { buildImportPlan, type ImportPlan } from "../src/importPlan.js";
import { readWorkoutText, type ReadResult } from "../src/workoutText.js";
import { TIMER_PASTES } from "./fixtures/timerPastes.js";
import { toWrite } from "./helpers/importPlan.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const planOf = (raw: string) => buildImportPlan(readWorkoutText(raw), () => "weight_reps");
const groups = (plan: ImportPlan) => plan.items.map((i) => i.supersetGroup);
const bullets = (n: number, prefix = "Move") => Array.from({ length: n }, (_, i) => `- 10 ${prefix} ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ""}`);
const untimed = <T extends { timer?: unknown }>(s: T): Omit<T, "timer"> => {
  const copy = { ...s };
  delete copy.timer;
  return copy;
};
const withoutTimers = (read: ReadResult): ReadResult => ({ ...read, sections: read.sections.map(untimed) });
const sectionsWithoutTimers = (plan: ImportPlan): ImportPlan => ({ ...plan, sections: plan.sections.map(untimed) });

/** FNV-1a over the JSON: a short, stable fingerprint of a large value for an inline snapshot. */
const digest = (value: unknown): string => {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(value)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};

describe("10.7 AC54 — the import plan keeps the text's supersets and fills in only when there are none", () => {
  it("fixture 19: Second Shift is Time Cap 20:00 and keeps its two supersets of two", () => {
    const plan = planOf(fixture("hiraya-2026-10-19.txt"));
    expect(plan.sections[2]!.name).toBe("Second Shift");
    expect(plan.sections[2]!.timer).toEqual({ format: "time_cap", capSeconds: 1200 });
    expect(Object.keys(plan.sections[2]!)).toEqual(["name", "notes", "timer"]);
    expect(plan.sections.filter((s) => "timer" in s)).toHaveLength(1);
    expect(groups(plan)).toEqual([null, 1, 1, 2, 2, 3, 3, 3]);
  });
  it("fixture 26: MORRO BAY is AMRAP 15:00 and keeps its groups", () => {
    const plan = planOf(fixture("hiraya-2026-10-26.txt"));
    expect(plan.sections[2]!.timer).toEqual({ format: "amrap", capSeconds: 900 });
    expect(groups(plan)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3]);
  });
  it("fixture 24: the plan is today's", () => {
    expect(digest(planOf(fixture("hiraya-2026-10-24.txt")))).toMatchInlineSnapshot(`"bda5cd71"`);
  });
  it("amrapBullets: the two loose items become one superset, with no notice", () => {
    const plan = planOf(TIMER_PASTES.amrapBullets.raw);
    expect(groups(plan)).toEqual([1, 1]);
    expect(plan.notices).toEqual([]);
  });
  it("timeCapBulletSingle: one item stays ungrouped", () => {
    const plan = planOf(TIMER_PASTES.timeCapBulletSingle.raw);
    expect(groups(plan)).toEqual([null]);
    expect(plan.sections[0]!.timer).toEqual({ format: "time_cap", capSeconds: null });
  });
  it("over 8: the first 8 are grouped, the rest ungrouped, with superset-split", () => {
    const plan = planOf(["Main", "ROUNDS/REPS", "AMRAP 10", ...bullets(10)].join("\n"));
    expect(groups(plan)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null, null]);
    expect(plan.notices).toEqual([{ code: "superset-split", count: 1 }]);
  });
  it("Review Focus 3: a run plus a loose item stays as the text gave it", () => {
    const plan = planOf("Main\nTIME\nFor Time:\n- 50 Burpees\n21-15-9\nThrusters\nPull-ups");
    expect(plan.items.map((i) => i.name)).toEqual(["Burpees", "Thrusters", "Pull-ups"]);
    expect(groups(plan)).toEqual([null, 1, 1]);
  });
});

describe("10.7 AC54 / Review Focus 4 — cuts come before the fill-in", () => {
  it("a timed section left out by the 8-section cap takes its timer with it", () => {
    const untimed = Array.from({ length: 8 }, (_, i) => [`S${i + 1}`, "NO SCORE", "- 10 Move A", "- 10 Move B"]).flat();
    const plan = planOf([...untimed, "Last", "ROUNDS/REPS", "AMRAP 10", "- 10 Burpees", "- 15 Air Squats"].join("\n"));
    expect(plan.notices).toContainEqual({ code: "sections-left-out", count: 1, names: ["Last"] });
    expect(plan.sections).toHaveLength(8);
    expect(plan.sections.some((s) => "timer" in s)).toBe(false);
  });
  it("a timed section cut by the 30-item cap groups only its kept items", () => {
    const plan = planOf(["Strength", "NO SCORE", ...bullets(28), "Main", "ROUNDS/REPS", "AMRAP 10", ...bullets(4, "Lift")].join("\n"));
    expect(plan.items).toHaveLength(30);
    expect(plan.notices).toContainEqual({ code: "items-left-out", count: 2 });
    expect(plan.items.slice(28).map((i) => [i.section, i.supersetGroup])).toEqual([[1, 1], [1, 1]]);
    expect(groups(plan).slice(0, 28).every((g) => g === null)).toBe(true);
  });
  it("group numbers stay in first-appearance order across sections", () => {
    const plan = planOf(["Main", "ROUNDS/REPS", "AMRAP 10", "- 10 Burpees", "- 15 Air Squats", "Accessory", "NO SCORE", "3 Rounds", "10 Squats", "10 Rows"].join("\n"));
    expect(plan.items.map((i) => [i.section, i.supersetGroup])).toEqual([[0, 1], [0, 1], [1, 2], [1, 2]]);
  });
});

describe("10.7 AC54 — untimed is untouched", () => {
  const raws = [
    fixture("hiraya-2026-10-19.txt"),
    fixture("hiraya-2026-10-24.txt"),
    fixture("hiraya-2026-10-26.txt"),
    ["Strength", "3 Rounds", "10 Squats", "10 Burpees", "Conditioning", "2 Rounds", "5 Rows", "5 Pushups"].join("\n"),
  ];
  it.each(raws.map((r, i) => [i, r]))("input %i: the timer only adds a key when the text already grouped it", (_, raw) => {
    const read = readWorkoutText(raw);
    expect(sectionsWithoutTimers(buildImportPlan(read, () => "weight_reps"))).toEqual(buildImportPlan(withoutTimers(read), () => "weight_reps"));
  });
});

const ORDER_RAW = ["Strength", "3 Rounds", "10 Squats", "10 Burpees", "Conditioning", "2 Rounds", "5 Rows", "5 Pushups"].join("\n");

// #263: digests captured on c433eab8 (the parent of #258), where no section had a timer, so a change to untimed
// numbering or grouping fails here even when the with/without-timers comparison above still agrees.
describe("10.7 AC54 / #263 — untimed numbering matches the pre-10.7 D base", () => {
  it.each<[string, string, string]>([
    ["hiraya-2026-10-19", fixture("hiraya-2026-10-19.txt"), "d1ad59fd"],
    ["hiraya-2026-10-24", fixture("hiraya-2026-10-24.txt"), "bda5cd71"],
    ["hiraya-2026-10-26", fixture("hiraya-2026-10-26.txt"), "e82804b9"],
    ["order", ORDER_RAW, "2de4886c"],
    ["setTimerAccessory", TIMER_PASTES.setTimerAccessory.raw, "163a1473"],
    ["timeCapColon", TIMER_PASTES.timeCapColon.raw, "7e7e8b6d"],
    ["twelveMinAmrap", TIMER_PASTES.twelveMinAmrap.raw, "7310d9f5"],
    ["amrapClock", TIMER_PASTES.amrapClock.raw, "0b3eae77"],
    ["bareForTime", TIMER_PASTES.bareForTime.raw, "e1747512"],
    ["scoreLineTime", TIMER_PASTES.scoreLineTime.raw, "b4e79c65"],
    ["scoreLineRounds", TIMER_PASTES.scoreLineRounds.raw, "3e71bd4c"],
    ["badgeBeatsScoreLine", TIMER_PASTES.badgeBeatsScoreLine.raw, "91702881"],
    ["amrapBullets", TIMER_PASTES.amrapBullets.raw, "9fa182a9"],
    ["timeCapBulletSingle", TIMER_PASTES.timeCapBulletSingle.raw, "fae4bb53"],
  ])("%s", (_, raw, base) => {
    expect(digest(buildImportPlan(withoutTimers(readWorkoutText(raw)), () => "weight_reps"))).toBe(base);
  });
});

describe("10.7 AC54 — toWrite with timers parses", () => {
  const raws = [
    ...Object.entries(TIMER_PASTES).map(([k, p]) => [k, p.raw]),
    ["fixture 19", fixture("hiraya-2026-10-19.txt")],
    ["fixture 24", fixture("hiraya-2026-10-24.txt")],
    ["fixture 26", fixture("hiraya-2026-10-26.txt")],
  ];
  it.each(raws)("%s", (_, raw) => {
    const write = toWrite(planOf(raw!));
    expect(RoutineWriteSchema.safeParse(write).success).toBe(true);
  });
  it("the timer reaches the write body", () => {
    const write = toWrite(planOf(fixture("hiraya-2026-10-19.txt"))) as { sections: { timer?: unknown }[] };
    expect(write.sections.map((s) => s.timer ?? null)).toEqual([null, null, { format: "time_cap", capSeconds: 1200 }, null]);
  });
});
