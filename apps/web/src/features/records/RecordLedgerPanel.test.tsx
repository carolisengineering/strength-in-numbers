import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { FirstTimeLines } from "./FirstTimeLines";
import { EST_1RM_EXPLAINED, type FirstTimeLine, type LedgerLift, type LedgerRow } from "./recordLedger";
import { RecordLedgerPanel } from "./RecordLedgerPanel";

const heavy: LedgerRow = { type: "heaviest_weight", label: "Heaviest weight", oldText: "80", newText: "82.5 kg", gainText: "+2.5 kg", spoken: "Heaviest weight: was 80 kg, now 82.5 kg, up 2.5 kg", sourceText: null };
const est: LedgerRow = { type: "best_est_1rm", label: "Est. 1-rep max", oldText: "94", newText: "96.5 kg", gainText: "+2.5 kg", spoken: "Est. 1-rep max: was 94 kg, now 96.5 kg, up 2.5 kg", sourceText: null };
const valueOnly: LedgerRow = { ...est, oldText: null, gainText: null, newText: "94 kg", spoken: "Est. 1-rep max: 94 kg" };
const liftOf = (name: string, rows: LedgerRow[] = [heavy], o: Partial<LedgerLift> = {}): LedgerLift => ({ key: name, name, rows, sourceText: null, hasEstimate: rows.some((r) => r.type === "best_est_1rm"), ...o });
const lifts = (n: number, last: LedgerRow[] = [heavy]) => Array.from({ length: n }, (_, i) => liftOf(`Lift ${i + 1}`, i === n - 1 ? last : [heavy]));
const panel = () => screen.getByRole("region");
const toggle = () => screen.getByRole("button", { name: /^Show / });

describe("17.6 AC2 — one panel", () => {
  it("one region named by its heading, one list, one item and one h3 per lift, no per-lift tint", () => {
    render(<RecordLedgerPanel heading="New records on 2 lifts" lifts={[liftOf("Bench Press"), liftOf("Overhead Press")]} />);
    const region = screen.getByRole("region", { name: "New records on 2 lifts" });
    expect(within(region).getAllByRole("list")).toHaveLength(1);
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(within(region).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Bench Press", "Overhead Press"]);
    for (const li of within(region).getAllByRole("listitem")) expect(li.className).not.toBe(region.className);
  });
});

describe("17.6 AC4 — a row is a ledger line", () => {
  it("old, arrow, new and gain in that order; a value-only row has no arrow; no was line", () => {
    render(<RecordLedgerPanel heading="New records on 2 lifts" lifts={[liftOf("Bench Press"), liftOf("Squat", [valueOnly])]} />);
    const [benchLine, squatLine] = [...panel().querySelectorAll<HTMLElement>("[aria-hidden='true']")];
    const text = benchLine!.textContent!;
    const at = (s: string) => text.indexOf(s);
    expect(at("Heaviest weight")).toBeGreaterThanOrEqual(0);
    expect([at("80"), at("→"), at("82.5 kg"), at("+2.5 kg")].every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]!))).toBe(true);
    expect(squatLine!.textContent).not.toContain("→");
    expect(squatLine!.textContent).toContain("94 kg");
    expect(screen.queryByText(/^was /)).toBeNull();
  });
});

describe("17.6 AC8 — the source line renders", () => {
  it("a shared line after the rows, or per-row lines under their figures", () => {
    render(
      <RecordLedgerPanel
        heading="New records on 2 lifts"
        lifts={[liftOf("Bench Press", [heavy, est], { sourceText: "from your 82.5 kg × 5" }), liftOf("Squat", [{ ...heavy, sourceText: "from your 140 kg × 3" }, { ...est, sourceText: "from your 130 kg × 6" }])]}
      />,
    );
    const [bench, squat] = within(panel()).getAllByRole("listitem");
    expect(bench!.lastElementChild).toHaveTextContent("from your 82.5 kg × 5");
    expect(within(bench!).getAllByText(/^from your/)).toHaveLength(1);
    expect(within(squat!).getAllByText(/^from your/).map((p) => p.textContent)).toEqual(["from your 140 kg × 3", "from your 130 kg × 6"]);
  });
});

describe("17.6 AC9 — the term is explained", () => {
  it("once with two estimate rows, never with none", () => {
    const { unmount } = render(<RecordLedgerPanel heading="New records on 2 lifts" lifts={[liftOf("Bench Press", [heavy, est]), liftOf("Squat", [est])]} />);
    expect(screen.getAllByText(EST_1RM_EXPLAINED)).toHaveLength(1);
    unmount();
    render(<RecordLedgerPanel heading="New record" lifts={[liftOf("Bench Press")]} />);
    expect(screen.queryByText(EST_1RM_EXPLAINED)).toBeNull();
  });

  it("Review Focus 2: only the fifth lift has an estimate: no explanation while collapsed, one once expanded", async () => {
    const user = userEvent.setup();
    render(<RecordLedgerPanel heading="New records on 5 lifts" lifts={lifts(5, [est])} />);
    expect(screen.queryByText(EST_1RM_EXPLAINED)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show all 5 lifts" }));
    expect(screen.getAllByText(EST_1RM_EXPLAINED)).toHaveLength(1);
  });
});

describe("17.6 AC11 / AC13 — long lists collapse", () => {
  it("4 lifts show all with no button", () => {
    render(<RecordLedgerPanel heading="New records on 4 lifts" lifts={lifts(4)} />);
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("5 lifts show 3; the same button expands and collapses, keeps focus, and the heading counts all", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecordLedgerPanel heading="New records on 5 lifts" lifts={lifts(5)} />);
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(3);
    const button = toggle();
    expect(button).toHaveTextContent("Show all 5 lifts");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(5);
    expect(toggle()).toBe(button);
    expect(button).toHaveTextContent("Show fewer");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveFocus();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("New records on 5 lifts");
    // Review Focus 2: a refetch that drops the list to 4 removes the button and shows all 4.
    rerender(<RecordLedgerPanel heading="New records on 4 lifts" lifts={lifts(4)} />);
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("first times follow the same rule in their own list", async () => {
    const user = userEvent.setup();
    const lines = (n: number): FirstTimeLine[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, text: `First time logged: Lift ${i + 1} 20 kg` }));
    const { unmount } = render(<FirstTimeLines lines={lines(4)} />);
    expect(within(screen.getByRole("list", { name: "First time logged" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    render(<FirstTimeLines lines={lines(6)} />);
    expect(within(screen.getByRole("list", { name: "First time logged" })).getAllByRole("listitem")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Show all 6 first times" }));
    expect(within(screen.getByRole("list", { name: "First time logged" })).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("17.6 AC17 — accessible", () => {
  it("each row is one sentence, its visible figure hidden; h2 then h3; nothing live", () => {
    render(<RecordLedgerPanel heading="New record" lifts={[liftOf("Bench Press")]} />);
    const sentence = screen.getByText("Heaviest weight: was 80 kg, now 82.5 kg, up 2.5 kg");
    expect(sentence.nextElementSibling).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("heading").map((h) => h.tagName)).toEqual(["H2", "H3"]);
    expect(document.querySelector("[aria-live], [role='status']")).toBeNull();
  });

  it("is axe-clean collapsed and expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(<RecordLedgerPanel heading="New records on 5 lifts" lifts={lifts(5, [heavy, est])} />);
    await expectNoAxeViolations(container);
    await user.click(toggle());
    await expectNoAxeViolations(container);
  });
});
