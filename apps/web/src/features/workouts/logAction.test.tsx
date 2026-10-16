import type { Modality } from "@sin/core";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLogActionStore, logLabel, useLogAction, type LogAction, type LogActionStore } from "./logAction";
import type { SetDraft } from "./setDraft";

const draft = (o: Partial<SetDraft> = {}): SetDraft => ({
  weight: "",
  reps: "",
  distance: "",
  minutes: "",
  seconds: "",
  rpe: "",
  weightUnit: "lb",
  distanceUnit: "km",
  setType: "working",
  attemptKey: "k",
  ...o,
});

describe("17.1 AC25 — logLabel follows the modality (§6.6 table)", () => {
  it.each<[string, Modality, Partial<SetDraft>, "kg" | "lb", string]>([
    ["weight × reps", "weight_reps", { weight: "185", reps: "5" }, "lb", "Log 185 × 5"],
    ["decimal weight, comma typed", "weight_reps", { weight: "102,5", reps: "5", weightUnit: "kg" }, "kg", "Log 102.5 × 5"],
    ["weight unit differs from the profile", "weight_reps", { weight: "82.5", reps: "5", weightUnit: "kg" }, "lb", "Log 82.5 kg × 5"],
    ["weighted bodyweight", "weighted_bodyweight", { weight: "25", reps: "8" }, "lb", "Log +25 × 8"],
    ["bodyweight reps", "bodyweight_reps", { reps: "12" }, "lb", "Log 12 reps"],
    ["one rep", "bodyweight_reps", { reps: "1" }, "lb", "Log 1 rep"],
    ["duration", "duration", { minutes: "1", seconds: "30" }, "lb", "Log 1:30"],
    ["distance and duration (distance unit always shown)", "distance_duration", { distance: "5", minutes: "25", seconds: "0" }, "kg", "Log 5 km · 25:00"],
    ["invalid draft", "weight_reps", { weight: "abc", reps: "5" }, "lb", "Log set"],
    ["empty draft", "weight_reps", {}, "lb", "Log set"],
  ])("%s", (_label, modality, values, pref, expected) => {
    expect(logLabel(modality, draft(values), pref)).toBe(expected);
  });
});

const action = (owner: symbol, label = "Log 185 × 5"): LogAction => ({
  owner,
  label,
  ariaLabel: `${label} for Bench Press`,
  disabled: false,
  busy: false,
  run: () => {},
});

describe("17.1 AC29 — the log action is a tiny external store (D11)", () => {
  it("publish replaces the snapshot and notifies; the snapshot is stable between publishes", () => {
    const store = createLogActionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const a = Symbol("a");
    expect(store.getSnapshot()).toBeNull();
    const first = action(a);
    store.publish(first);
    expect(store.getSnapshot()).toBe(first);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.publish(action(a, "Log 190 × 5"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("withdraw clears only its own action (an unmounting panel never clears its successor's)", () => {
    const store = createLogActionStore();
    const a = Symbol("a");
    const b = Symbol("b");
    store.publish(action(a));
    store.publish(action(b, "Log 105 × 6"));
    store.withdraw(a);
    expect(store.getSnapshot()?.label).toBe("Log 105 × 6");
    store.withdraw(b);
    expect(store.getSnapshot()).toBeNull();
  });

  it("useLogAction re-renders only its subscriber", () => {
    const store = createLogActionStore();
    const renders = { reader: 0, sibling: 0 };
    function Reader({ s }: { s: LogActionStore }) {
      renders.reader += 1;
      return <p>{useLogAction(s)?.label ?? "none"}</p>;
    }
    function Sibling() {
      renders.sibling += 1;
      return null;
    }
    const { getByText } = render(
      <>
        <Reader s={store} />
        <Sibling />
      </>,
    );
    act(() => store.publish(action(Symbol("a"), "Log 190 × 5")));
    expect(getByText("Log 190 × 5")).toBeInTheDocument();
    expect(renders.sibling).toBe(1);
    expect(renders.reader).toBe(2);
  });

  it("with no store it reads null", () => {
    function Reader() {
      return <p>{useLogAction(null) === null ? "none" : "some"}</p>;
    }
    const { getByText } = render(<Reader />);
    expect(getByText("none")).toBeInTheDocument();
  });
});
