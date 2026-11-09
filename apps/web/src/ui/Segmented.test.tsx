import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Segmented, type SegmentedOption } from "./Segmented";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Segmented.module.css"), "utf8");
const ruleFor = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
};

type Unit = "kg" | "lb";
const UNITS: readonly SegmentedOption<Unit>[] = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
];
type Kind = "working" | "warmup" | "drop" | "failure";
const KINDS: readonly SegmentedOption<Kind>[] = [
  { value: "working", label: "Working" },
  { value: "warmup", label: "Warm-up" },
  { value: "drop", label: "Drop" },
  { value: "failure", label: "Failure" },
];

function Controlled({ initial, onChange }: { initial: Kind | null; onChange: (value: Kind) => void }) {
  const [value, setValue] = useState<Kind | null>(initial);
  return (
    <>
      <button type="button">before</button>
      <Segmented
        name="kind"
        legend="Set type"
        options={KINDS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">after</button>
    </>
  );
}

describe("17.7 AC1 — Segmented is one labeled group of native radios", () => {
  it("has one radio per option in a group named by the legend, and no radiogroup role", () => {
    render(<Segmented name="unit" legend="Weight unit" options={UNITS} value="lb" onChange={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Weight unit" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(["kg", "lb"]);
    expect(within(group).getByRole("radio", { name: "lb" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "kg" })).not.toBeChecked();
  });

  it("moves and chooses with the arrow keys, and is one Tab stop", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="working" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "before" }));
    await user.tab();
    expect(screen.getByRole("radio", { name: "Working" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("warmup");
    expect(screen.getByRole("radio", { name: "Warm-up" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Warm-up" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("fills the checked option with the selected tokens, rounds the strip, and gives each option the tap target", () => {
    expect(ruleFor(".option:has(.radio:checked)")).toMatch(/background:\s*var\(--color-selected\)/);
    expect(ruleFor(".option:has(.radio:checked)")).toMatch(/color:\s*var\(--color-on-selected\)/);
    expect(ruleFor(".options")).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(ruleFor(".option")).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(ruleFor(".option")).toMatch(/min-width:\s*var\(--tap-target-min\)/);
  });

  it("styles its radio with two classes, so a Field's input rule can't restyle it", () => {
    expect(css).toMatch(/\.option \.radio\s*\{/);
  });
});

describe("17.7 AC2 — narrow widths wrap rather than clip", () => {
  it("gives a four-option strip the four rule, built on the two tokens", () => {
    render(<Segmented name="kind" legend="Set type" options={KINDS} value="working" onChange={vi.fn()} />);
    const strip = screen.getByRole("radio", { name: "Working" }).closest("label")!.parentElement!;
    expect(strip.className).toMatch(/four/);
    expect(ruleFor(".four")).toContain("var(--segment-min-width)");
    expect(ruleFor(".four")).toContain("var(--segment-strip-min)");
    expect(ruleFor(".options")).toContain("var(--segment-min-width)");
  });

  it("leaves a two-option strip on the plain rule", () => {
    render(<Segmented name="unit" legend="Weight unit" options={UNITS} value="kg" onChange={vi.fn()} />);
    const strip = screen.getByRole("radio", { name: "kg" }).closest("label")!.parentElement!;
    expect(strip.className).not.toMatch(/four/);
  });
});

describe("17.7 AC3 — no selection", () => {
  it("checks nothing when the value is null, and a click still chooses", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented name="unit" legend="Weight unit" options={UNITS} value={null} onChange={onChange} />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    await user.click(screen.getByRole("radio", { name: "kg" }));
    expect(onChange).toHaveBeenCalledWith("kg");
  });
});

describe("17.7 AC10 — hint and error", () => {
  it("shows the error as an alert, and the group names both the hint and the error", () => {
    render(<Segmented name="units" legend="Units" options={UNITS} value="kg" onChange={vi.fn()} hint="Used for new sets." error="Choose kg or lb." />);
    const group = screen.getByRole("group", { name: "Units" });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose kg or lb.");
    expect(group).toHaveAccessibleDescription("Used for new sets. Choose kg or lb.");
    expect(group).not.toHaveAttribute("aria-invalid");
  });

  it("names nothing when there is no hint or error", () => {
    render(<Segmented name="units" legend="Units" options={UNITS} value="kg" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Units" })).not.toHaveAttribute("aria-describedby");
  });
});

describe("17.7 AC1 — disabled", () => {
  it("disables each radio, and so does a disabled fieldset around it", () => {
    const { rerender } = render(<Segmented name="unit" legend="Weight unit" options={UNITS} value="kg" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    rerender(
      <fieldset disabled>
        <Segmented name="unit" legend="Weight unit" options={UNITS} value="kg" onChange={vi.fn()} />
      </fieldset>,
    );
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });

  it("reads a disabled option as unavailable", () => {
    expect(ruleFor(".option:has(.radio:disabled)")).toMatch(/cursor:\s*not-allowed/);
    expect(ruleFor(".option:has(.radio:disabled)")).toMatch(/color:\s*var\(--color-muted\)/);
  });
});
