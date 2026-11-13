import { render, screen, within } from "@testing-library/react";
import { RECORD_TYPE_VALUES, type RecordType, type UnitPreference } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makePersonalRecord } from "../../test/workoutFixtures";
import { FIRST_RECORD, recordLabel, recordParts } from "./labels";
import { RecordRows } from "./RecordRows";

// [type, unit, value, previous, pref, value text, was text]
const TABLE: [RecordType, string, number, number, UnitPreference, string, string][] = [
  ["heaviest_weight", "kg", 82.5, 80, "kg", "82.5 kg", "80 kg"],
  ["heaviest_weight", "kg", 100, 20, "lb", "220.5 lb", "44.1 lb"],
  ["best_est_1rm", "kg", 122.5, 115, "kg", "122.5 kg", "115 kg"],
  ["best_est_1rm", "kg", 100, 20, "lb", "220 lb", "44 lb"],
  ["best_set_volume", "kg_reps", 6420, 100, "kg", "6,420 kg", "100 kg"],
  ["best_set_volume", "kg_reps", 6420, 100, "lb", "14,153.7 lb", "220.5 lb"],
  ["max_reps", "reps", 12, 10, "kg", "12 reps", "10 reps"],
  ["max_reps", "reps", 12, 10, "lb", "12 reps", "10 reps"],
  ["max_calories", "cal", 120, 110, "kg", "120 cal", "110 cal"],
  ["max_calories", "cal", 120, 110, "lb", "120 cal", "110 cal"],
  ["max_distance", "m", 1200, 40, "kg", "1,200 m", "40 m"],
  ["max_distance", "m", 1200, 40, "lb", "1,200 m", "40 m"],
  ["max_duration", "s", 90, 45, "kg", "1 min 30 s", "45 s"],
  ["max_duration", "s", 90, 45, "lb", "1 min 30 s", "45 s"],
];

describe("17.11 AC7 — recordParts gives a record's label, value and previous value", () => {
  it("the table covers every record type in kg and lb", () => {
    for (const type of RECORD_TYPE_VALUES) {
      expect(TABLE.filter(([t, , , , pref]) => t === type && pref === "kg")).toHaveLength(1);
      expect(TABLE.filter(([t, , , , pref]) => t === type && pref === "lb")).toHaveLength(1);
    }
  });

  it.each(TABLE)("%s (%s) %s was %s in %s → %s, was %s", (recordType, unit, value, previousValue, pref, valueText, wasText) => {
    const record = makePersonalRecord({ recordType, unit, value, previousValue });
    expect(recordParts(record, pref)).toEqual({ label: recordLabel(recordType), value: valueText, was: wasText, first: false });
  });

  it("a first record has was: null", () => {
    const record = makePersonalRecord({ value: 82.5, previousValue: null });
    expect(recordParts(record, "kg")).toEqual({ label: "Heaviest weight", value: "82.5 kg", was: null, first: true });
  });

  it("18.1 AC28 — a calories record keeps its values", () => {
    const r = makePersonalRecord({ exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 120, previousValue: 110 });
    expect(recordParts(r, "kg")).toEqual({ label: "Most calories", value: "120 cal", was: "110 cal", first: false });
    expect(recordParts({ ...r, previousValue: null }, "kg")).toEqual({ label: "Most calories", value: "120 cal", was: null, first: true });
  });
});

describe("17.11 AC7 — RecordRows draws name-free rows", () => {
  it("no row names the exercise; was and First record render; the given order is kept", () => {
    const records = [
      makePersonalRecord({ exerciseName: "Bench Press", recordType: "max_reps", unit: "reps", value: 12, previousValue: null }),
      makePersonalRecord({ exerciseName: "Bench Press", value: 82.5, previousValue: 80 }),
    ];
    render(<RecordRows records={records} unitPreference="kg" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.textContent).not.toContain("Bench Press");
    expect(rows[0]).toHaveTextContent("Most reps");
    expect(within(rows[0]!).getByText(FIRST_RECORD)).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Heaviest weight");
    expect(within(rows[1]!).getByText("was 80 kg")).toBeInTheDocument();
  });
});

describe("17.11 AC8 — labels come from recordLabel", () => {
  it.each(RECORD_TYPE_VALUES.map((t) => [t]))("%s", (type) => {
    const row = TABLE.find(([t]) => t === type)!;
    const record = makePersonalRecord({ recordType: type, unit: row[1], value: row[2], previousValue: row[3] });
    expect(recordParts(record, "kg").label).toBe(recordLabel(type));
  });
});

describe("17.11 AC9 — a row reads as a sentence", () => {
  it("the list is a list; a row reads label: value, was …; a first record reads label: value, First record", () => {
    render(
      <RecordRows
        records={[
          makePersonalRecord({ value: 82.5, previousValue: 80 }),
          makePersonalRecord({ value: 82.5, previousValue: null }),
        ]}
        unitPreference="kg"
      />,
    );
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]!.textContent).toBe("Heaviest weight: 82.5 kg, was 80 kg");
    expect(rows[1]!.textContent).toBe("Heaviest weight: 82.5 kg, First record");
  });
});

describe("minor 511 — an old and new value that read the same show the value alone", () => {
  // 100 kg and 100.01 kg both read 220.5 lb.
  const same = () => makePersonalRecord({ exerciseName: "Bench Press", value: 100.01, previousValue: 100 });

  it("recordParts gives no was, and it isn't a first record", () => {
    expect(recordParts(same(), "lb")).toEqual({ label: "Heaviest weight", value: "220.5 lb", was: null, first: false });
  });

  it("the row shows the value with neither a was line nor First record", () => {
    render(<RecordRows records={[same()]} unitPreference="lb" />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("220.5 lb");
    expect(row).not.toHaveTextContent(/was/);
    expect(row).not.toHaveTextContent(FIRST_RECORD);
  });

  it("a real first record still says First record", () => {
    render(<RecordRows records={[makePersonalRecord({ value: 82.5, previousValue: null })]} unitPreference="kg" />);
    expect(screen.getByRole("listitem")).toHaveTextContent(FIRST_RECORD);
  });
});

