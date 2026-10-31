import { describe, expect, it } from "vitest";
import { HEVY_IMPORT_OUTCOME_VALUES, type HevyImportOutcome, type HevyImportResult, type HevyWorkout } from "@sin/core";

import { aggregateResults, confirmLabel, sendable, summaryLists } from "./importSummary";
import { DROP_LABELS, OUTCOME_LABELS, UNREADABLE_LABEL } from "./messages";

const result = (id: string, outcome: HevyImportOutcome, over: Partial<HevyImportResult> = {}): HevyImportResult => ({
  hevyWorkoutId: id,
  outcome,
  workoutId: null,
  matchedWorkoutId: null,
  unpaired: [],
  drops: [],
  notices: [],
  exerciseCount: 2,
  setCount: 6,
  ...over,
});

const allOutcomes = HEVY_IMPORT_OUTCOME_VALUES.map((o, i) =>
  result(`h${i}`, o, {
    ...(o === "unpaired" ? { unpaired: ["T9", "T8"] } : {}),
    ...(o === "create"
      ? { drops: [{ code: "set_out_of_range", count: 2 }, { code: "exercise_no_sets", count: 1 }, { code: "set_missing_measure", count: 1 }] }
      : {}),
    ...(o === "duplicate" ? { drops: [{ code: "set_out_of_range", count: 1 }] } : {}),
  }),
);

describe("20.1 AC12 — aggregateResults", () => {
  const agg = aggregateResults(allOutcomes, ["u1", "u2"]);

  it("counts each outcome group", () => {
    expect(agg).toMatchObject({
      read: 12,
      create: 1,
      alreadyInSin: 2,
      sentFromSin: 1,
      duplicate: 1,
      deletedInSin: 1,
      cannotImport: 5,
      unpaired: 1,
    });
  });

  it("the outcome groups add up to the number read", () => {
    expect(agg.read).toBe(agg.create + agg.alreadyInSin + agg.sentFromSin + agg.duplicate + agg.deletedInSin + agg.cannotImport + agg.unpaired);
  });

  it("sums drops per code; exercise_no_sets is in drops but not in the dropped sets", () => {
    expect(agg.drops).toEqual({ exercise_skipped: 0, exercise_no_sets: 1, set_missing_measure: 1, set_forbidden_measure: 0, set_out_of_range: 3 });
    expect(agg.setsDropped).toBe(4);
  });

  it("keeps the sets of create and duplicate results", () => {
    expect(agg.setsKept).toBe(12);
  });
});

describe("20.1 AC13 — unpaired templates", () => {
  it("is the deduplicated union of the results' unpaired ids", () => {
    const agg = aggregateResults([result("a", "unpaired", { unpaired: ["T1", "T2"] }), result("b", "unpaired", { unpaired: ["T2", "T3"] })], []);
    expect(agg.unpairedTemplates).toEqual(["T1", "T2", "T3"]);
  });
});

const hevyWorkout = (id: string, title: string, start: string): HevyWorkout => ({ id, title, start_time: start, end_time: start, exercises: [] });

describe("20.1 AC12 — summaryLists", () => {
  const workouts = new Map(
    [
      hevyWorkout("dup", "Push", "2026-03-02T12:00:00Z"),
      hevyWorkout("bad", "   ", "2026-03-05T12:00:00Z"),
      hevyWorkout("empty", "", "2026-03-01T12:00:00Z"),
      hevyWorkout("late", "Late one", "2026-03-03T23:30:00Z"),
      hevyWorkout("drop", "Legs", "2026-03-04T12:00:00Z"),
      hevyWorkout("u1", "<b>x</b>", "2026-03-06T12:00:00Z"),
      hevyWorkout("np", "Pull", "2026-03-07T12:00:00Z"),
    ].map((w) => [w.id, w]),
  );
  const results = [
    result("dup", "duplicate"),
    result("bad", "time_invalid"),
    result("empty", "no_usable_sets"),
    result("late", "rejected"),
    result("drop", "create", { drops: [{ code: "set_out_of_range", count: 2 }] }),
    result("np", "unpaired", { unpaired: ["T1"] }),
  ];

  it("groups rows with their reasons, untitled where blank, newest first", () => {
    const lists = summaryLists(results, workouts, ["u1"], "America/Chicago");
    expect(lists.map((g) => g.group)).toEqual(["duplicate", "cannot_import", "sets_dropped", "unpaired"]);
    const cannot = lists.find((g) => g.group === "cannot_import")!.rows;
    expect(cannot.map((r) => [r.id, r.date, r.title, r.reason])).toEqual([
      ["u1", "2026-03-06", "<b>x</b>", UNREADABLE_LABEL],
      ["bad", "2026-03-05", "Untitled", OUTCOME_LABELS.time_invalid],
      ["late", "2026-03-03", "Late one", OUTCOME_LABELS.rejected],
      ["empty", "2026-03-01", "Untitled", OUTCOME_LABELS.no_usable_sets],
    ]);
    expect(lists.find((g) => g.group === "sets_dropped")!.rows).toEqual([
      { id: "drop", date: "2026-03-04", title: "Legs", reason: `${DROP_LABELS.set_out_of_range} (2)` },
    ]);
    expect(lists.find((g) => g.group === "duplicate")!.rows[0]).toMatchObject({ id: "dup", reason: OUTCOME_LABELS.duplicate });
  });

  it("uses the device zone for the local date", () => {
    const late = (zone: string) => summaryLists(results, workouts, [], zone).find((g) => g.group === "cannot_import")!.rows.find((r) => r.id === "late")!.date;
    expect(late("America/Chicago")).toBe("2026-03-03");
    expect(late("Europe/Berlin")).toBe("2026-03-04");
  });

  it("leaves out empty groups", () => {
    expect(summaryLists([result("x", "create")], new Map([["x", hevyWorkout("x", "A", "2026-01-01T00:00:00Z")]]), [], "UTC")).toEqual([]);
  });
});

describe("20.1 AC14 — confirm label and what the run sends", () => {
  const results = [result("a", "create"), result("b", "duplicate"), result("c", "already_imported"), result("d", "unpaired")];

  it("sendable is create and duplicate, in order", () => {
    expect(sendable(results)).toEqual(["a", "b"]);
  });

  it("names the workouts to create and the routines; nothing at all is Nothing new to import", () => {
    const agg = aggregateResults(results, []);
    expect(confirmLabel(agg, 0, 2)).toBe("Import 1 workout");
    expect(confirmLabel({ ...agg, create: 960 }, 12, 961)).toBe("Import 960 workouts and 12 routines");
    expect(confirmLabel(aggregateResults([], []), 0, 0)).toBe("Nothing new to import");
    expect(confirmLabel(aggregateResults([], []), 2, 0)).toBe("Import 2 routines");
  });
});

describe("Minor 239 — words when no workout is created", () => {
  const none = aggregateResults([], []);
  it("matches only: the workouts are linked", () => {
    expect(confirmLabel({ ...none, duplicate: 3 }, 0, 3)).toBe("Link 3 workouts");
    expect(confirmLabel({ ...none, duplicate: 1 }, 0, 1)).toBe("Link 1 workout");
    expect(confirmLabel({ ...none, duplicate: 3 }, 2, 3)).toBe("Link 3 workouts and import 2 routines");
  });

  it("routines only: no workout count", () => {
    expect(confirmLabel(none, 1, 0)).toBe("Import 1 routine");
  });

  it("only workouts waiting for a pairing: no count", () => {
    expect(confirmLabel({ ...none, unpaired: 4 }, 0, 0)).toBe("Import workouts");
  });

  it("with workouts to create, the words are unchanged", () => {
    expect(confirmLabel({ ...none, create: 5, duplicate: 3 }, 0, 8)).toBe("Import 5 workouts");
    expect(confirmLabel({ ...none, create: 5, duplicate: 3 }, 2, 8)).toBe("Import 5 workouts and 2 routines");
  });
});
