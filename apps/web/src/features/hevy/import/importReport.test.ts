import { describe, expect, it, vi } from "vitest";
import type { HevyImportResult, HevyWorkout } from "@sin/core";

import { VALID_KEY } from "../../../test/hevyHarness";
import type { RoutineOutcome } from "./createRoutines";
import { buildImportReport, csvField, downloadReport, REPORT_FILENAME } from "./importReport";
import { finalResults } from "./importSummary";
import { UNREADABLE_LABEL } from "./messages";

const workout = (id: string, title: string, start = "2026-07-01T09:00:00Z"): HevyWorkout => ({
  id,
  title,
  start_time: start,
  end_time: start,
  exercises: [],
});
const result = (id: string, outcome: HevyImportResult["outcome"], extra: Partial<HevyImportResult> = {}): HevyImportResult => ({
  hevyWorkoutId: id,
  outcome,
  workoutId: null,
  matchedWorkoutId: null,
  unpaired: [],
  drops: [],
  notices: [],
  exerciseCount: 1,
  setCount: 1,
  ...extra,
});
const routine = (name: string, kind: RoutineOutcome["kind"], notices: RoutineOutcome["notices"] = []): RoutineOutcome => ({ hevyRoutineId: name, name, kind, notices });

const workouts = new Map(
  [
    workout("plain", "Plain"),
    workout("drops", "Push"),
    workout("dup", "Pull", "2026-06-01T09:00:00Z"),
    workout("rej", "Legs"),
    workout("odd", "Odd one"),
    workout("long", "x".repeat(201)),
    workout("comma", 'Push, "heavy"'),
    workout("formula", "=SUM(A1)"),
    workout("tab", "\tTabbed"),
    workout("break", "Line\nbreak"),
    workout("stopped", "Never sent"),
  ].map((w) => [w.id, w]),
);

const rows = (csv: string) => csv.split("\r\n").filter((l) => l !== "");

describe("20.1 AC26 — report", () => {
  const dryRun = [
    result("plain", "create"),
    result("drops", "create"),
    result("dup", "duplicate"),
    result("rej", "rejected"),
    result("comma", "already_imported"),
    result("formula", "deleted_in_sin"),
    result("tab", "sent_from_sin"),
    result("break", "no_usable_sets"),
    result("stopped", "create"),
  ];
  const run = [result("plain", "create"), result("drops", "create", { drops: [{ code: "set_missing_measure", count: 2 }] }), result("dup", "create")];
  const report = () =>
    buildImportReport({
      ...finalResults(dryRun, run),
      workouts,
      unreadable: ["odd", "long"],
      routines: [routine("Push A", "created", [{ code: "name_trimmed", count: 1 }]), routine("Pull A", "limit_not_created")],
      zone: "UTC",
    });

  it("has the exact header, one row per non-plain workout, the stopped, the unreadable and each routine; CRLF, no BOM", () => {
    const csv = report();
    expect(csv.startsWith("kind,date,title,outcome,detail\r\n")).toBe(true);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    // drops, comma, formula, tab, break, rej, stopped, odd, long, two routines
    expect(rows(csv)).toHaveLength(1 + 11);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("a plain create gives no row; a create with drops gives one with the codes", () => {
    const csv = report();
    expect(csv).not.toContain("Plain");
    expect(rows(csv)).toContain("workout,2026-07-01,Push,create,set_missing_measure×2");
  });

  it("a dry-run duplicate that the run created gives no row", () => {
    expect(rows(report()).some((r) => r.startsWith("workout,") && r.includes(",Pull,"))).toBe(false);
  });

  it("an unreadable workout (an unknown set type, or a title over 200) gives one unreadable row each", () => {
    const csv = report();
    expect(rows(csv)).toContain(`workout,2026-07-01,Odd one,unreadable,${UNREADABLE_LABEL}`);
    expect(rows(csv).filter((r) => r.includes(",unreadable,"))).toHaveLength(2);
  });

  it("a sendable workout never sent is Not imported (stopped)", () => {
    expect(rows(report())).toContain("workout,2026-07-01,Never sent,not_imported_stopped,");
  });

  it("routines: empty date, the name, the outcome and the notices", () => {
    const csv = report();
    expect(rows(csv)).toContain("routine,,Push A,created,name_trimmed×1");
    expect(rows(csv)).toContain("routine,,Pull A,limit_not_created,");
  });

  it("quotes a comma, a quote and a line break; prefixes a formula, a tab or a CR (Review Focus 4)", () => {
    const csv = report();
    expect(csv).toContain(`"Push, ""heavy"""`);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'\tTabbed");
    expect(csv).toContain('"Line\nbreak"');
    expect(csvField("\rx")).toBe(`"'\rx"`);
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("-1")).toBe("'-1");
    expect(csvField("@a")).toBe("'@a");
    expect(csvField("plain")).toBe("plain");
  });

  it("never holds the Hevy key", () => {
    for (const row of rows(report())) expect(row).not.toContain(VALID_KEY);
  });

  it("downloads as text/csv named hevy-import-report.csv", async () => {
    const save = vi.fn();
    downloadReport("a,b\r\n", save);
    const [blob, name] = save.mock.calls[0] as [Blob, string];
    expect(name).toBe(REPORT_FILENAME);
    expect(name).toBe("hevy-import-report.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe("a,b\r\n");
  });
});
