import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { stripCssComments } from "../test/sourceScan";
import { RadioChip } from "./RadioChip";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = () => stripCssComments(readFileSync(join(HERE, "RadioChip.module.css"), "utf8"));
const ruleOf = (selector: string) => [...css().matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.trim() === selector)?.[2] ?? "";

describe("17.13 AC16 — radios have two looks: RadioChip", () => {
  it("is a labeled native radio; checked, name, value and onChange reach the input", async () => {
    const onChange = vi.fn();
    render(
      <RadioChip name="kind" value="a" checked={false} onChange={onChange}>
        Weight × reps
      </RadioChip>,
    );
    const radio = screen.getByRole("radio", { name: "Weight × reps" });
    expect(radio).toHaveAttribute("name", "kind");
    expect(radio).toHaveAttribute("value", "a");
    expect(radio).not.toBeChecked();
    await userEvent.setup().click(radio);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("block adds its class to the label", () => {
    render(
      <RadioChip name="k" checked onChange={() => {}} block>
        Long template name
      </RadioChip>,
    );
    expect(screen.getByRole("radio").closest("label")!.className).toMatch(/block/);
  });

  it("review focus 2: ref reaches the input", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <RadioChip name="k" checked onChange={() => {}} ref={ref}>
        X
      </RadioChip>,
    );
    expect(ref.current).toBe(screen.getByRole("radio"));
  });

  it("review focus 4: a disabled chip can't be chosen and calls no onChange", async () => {
    const onChange = vi.fn();
    render(
      <RadioChip name="k" checked={false} disabled onChange={onChange}>
        No type
      </RadioChip>,
    );
    const radio = screen.getByRole("radio", { name: "No type" });
    expect(radio).toBeDisabled();
    await userEvent.setup().click(radio);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("its CSS: 44 px, wraps a long name, the selected border, a muted disabled chip, a sized radio", () => {
    expect(ruleOf(".chip")).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(ruleOf(".chip")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(ruleOf(".chip:has(input:checked)")).toMatch(/border-color:\s*var\(--color-selected\)/);
    expect(ruleOf(".chip:has(input:disabled)")).toMatch(/color:\s*var\(--color-muted\)/);
    expect(ruleOf(".chip input")).toMatch(/width:\s*var\(--radio-size\)/);
    expect(ruleOf(".block")).toMatch(/width:\s*100%/);
  });
});

describe("17.13 AC21 — tokens and roles", () => {
  it("--radio-size is a token; RadioChip's CSS has no hard-coded color or px beyond 1px", () => {
    const tokens = readFileSync(join(HERE, "tokens.css"), "utf8");
    expect(tokens).toMatch(/--radio-size:\s*1\.25rem;/);
    expect(css()).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    for (const m of css().matchAll(/(\d+(?:\.\d+)?)px/g)) expect(m[1]).toBe("1");
  });
});

describe("17.13 review focus 3 — a match tag never breaks inside a word", () => {
  const read = (rel: string) => stripCssComments(readFileSync(join(HERE, rel), "utf8"));
  it.each(["../features/routines/import/ImportNames.module.css", "../features/hevy/pairing/PairingCard.module.css"])("%s .tag is one unbroken inline block", (rel) => {
    const tag = [...read(rel).matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.trim() === ".tag")?.[2] ?? "";
    expect(tag).toMatch(/display:\s*inline-block/);
    expect(tag).toMatch(/white-space:\s*nowrap/);
  });
});
