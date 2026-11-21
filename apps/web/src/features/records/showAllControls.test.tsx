import type { PersonalRecord } from "@sin/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makePersonalRecord } from "../../test/workoutFixtures";
import { FirstTimeLines } from "./FirstTimeLines";
import type { FirstTimeLine, LedgerLift, LedgerRow } from "./recordLedger";
import { RecordLedgerPanel } from "./RecordLedgerPanel";
import { RecordsSection } from "./RecordsSection";
import { recordsToShow } from "./repsAtWeightRows";

/** The button's `aria-controls` names the list it opens and closes. */
function expectControlsList(button: HTMLElement) {
  const id = button.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)?.tagName).toBe("UL");
}

const row: LedgerRow = { key: "heaviest_weight:", type: "heaviest_weight", label: "Heaviest weight", oldText: "80", newText: "82.5 kg", gainText: "+2.5 kg", spoken: "Heaviest weight: was 80 kg, now 82.5 kg, up 2.5 kg", sourceText: null };
const lift = (i: number): LedgerLift => ({ key: `l${i}`, name: `Lift ${i}`, rows: [row], sourceText: null, hasEstimate: false });

describe("17.6 AC11, 07.5 AC39 — each Show all names the list it opens (minor 689)", () => {
  it("the ledger's lifts", () => {
    render(<RecordLedgerPanel heading="New records on 5 lifts" lifts={[1, 2, 3, 4, 5].map(lift)} />);
    expectControlsList(screen.getByRole("button", { name: "Show all 5 lifts" }));
  });
  it("the first-time lines", () => {
    const lines: FirstTimeLine[] = [1, 2, 3, 4, 5].map((i) => ({ key: `f${i}`, text: `First time logged: Lift ${i} 20 kg`, estimate: false }));
    render(<FirstTimeLines lines={lines} explain={false} />);
    expectControlsList(screen.getByRole("button", { name: "Show all 5 first times" }));
  });
  it("the exercise page's weights", () => {
    const records = [10, 12.5, 15, 17.5, 20, 22.5].map((atWeightKg) => makePersonalRecord({ recordType: "max_reps_at_weight", unit: "reps", value: 8, previousValue: 6, atWeightKg }));
    const query = { isPending: false, isError: false, data: records, error: null, refetch: async () => undefined } as unknown as UseQueryResult<PersonalRecord[]>;
    render(<RecordsSection query={query} unitPreference="kg" />);
    expectControlsList(screen.getByRole("button", { name: "Show all 6 weights" }));
  });
});

describe("07.5 AC39 — the newest weights by time, not by text (minor 686)", () => {
  it("an offset timestamp that is later in time wins the last slot", () => {
    const rec = (atWeightKg: number, achievedAt: string) => makePersonalRecord({ recordType: "max_reps_at_weight", unit: "reps", value: 8, previousValue: 6, atWeightKg, achievedAt });
    // 30 kg at 23:00 -05:00 is 04:00Z on Oct 6, three hours after 25 kg at 01:00Z; as text it reads a day earlier.
    const records = [rec(30, "2026-10-05T23:00:00.000-05:00"), rec(25, "2026-10-06T01:00:00.000Z"), ...[10, 12, 14, 16].map((w, i) => rec(w, `2026-10-2${i}T10:00:00.000Z`))];
    const shown = recordsToShow(records, false).shown.map((r) => r.atWeightKg);
    expect(shown).toContain(30);
    expect(shown).not.toContain(25);
  });
});
