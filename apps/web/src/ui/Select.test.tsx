import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { Field } from "./Field";
import { Select } from "./Select";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Select.module.css"), "utf8");
const ruleFor = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
};

describe("17.7 AC4 — Select wraps a real select", () => {
  it("takes Field's wiring on the select itself, not the wrapper", () => {
    render(
      <Field id="muscle" label="Primary muscle" hint="Pick one" error="Required">
        {(control) => (
          <Select {...control} value="" onChange={() => {}}>
            <option value="">Choose…</option>
            <option value="chest">Chest</option>
          </Select>
        )}
      </Field>,
    );
    const select = screen.getByLabelText("Primary muscle");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveRole("combobox");
    expect(select).toHaveAttribute("id", "muscle");
    expect(select).toHaveAttribute("aria-describedby", "muscle-hint muscle-error");
    expect(select).toHaveAttribute("aria-invalid", "true");
    const wrap = select.parentElement!;
    expect(wrap.tagName).toBe("SPAN");
    expect(wrap).not.toHaveAttribute("id");
    expect(wrap).not.toHaveAttribute("aria-invalid");
  });

  it("forwards aria-label, disabled, value and onChange, and native options work", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Select aria-label="Muscle" value="chest" onChange={(event) => onChange(event.target.value)}>
        <option value="chest">Chest</option>
        <option value="back">Back</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Muscle" });
    expect(select).toHaveValue("chest");
    await user.selectOptions(select, "Back");
    expect(onChange).toHaveBeenCalledWith("back");
    rerender(
      <Select aria-label="Muscle" value="chest" onChange={() => {}} disabled>
        <option value="chest">Chest</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Muscle" })).toBeDisabled();
  });

  it("draws one hidden chevron beside the select", () => {
    render(
      <Select aria-label="Muscle" value="a" onChange={() => {}}>
        <option value="a">A</option>
      </Select>,
    );
    const wrap = screen.getByRole("combobox").parentElement!;
    const icons = wrap.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("can shrink to its content for a filter", () => {
    const { container } = render(
      <>
        <Select aria-label="Full" value="a" onChange={() => {}}>
          <option value="a">A</option>
        </Select>
        <Select aria-label="Inline" inline value="a" onChange={() => {}}>
          <option value="a">A</option>
        </Select>
      </>,
    );
    const [full, inline] = [...container.querySelectorAll("span")];
    expect(inline!.className).not.toBe(full!.className);
    expect(ruleFor(".inline")).toMatch(/width:\s*auto/);
  });

  it("has the field's look, drawn by tokens, with no data: URL", () => {
    const select = ruleFor(".wrap .select");
    expect(select).toMatch(/appearance:\s*none/);
    expect(select).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(select).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(select).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(select).toContain("var(--select-chevron-gutter)");
    expect(ruleFor(".wrap .chevron")).toMatch(/pointer-events:\s*none/);
    expect(ruleFor(".wrap .chevron")).toMatch(/color:\s*var\(--color-text\)/);
    expect(css).not.toContain("data:");
  });

  it("keeps an invalid select's red border whatever the stylesheet order", () => {
    expect(ruleFor('.wrap .select[aria-invalid="true"]')).toMatch(/border-color:\s*var\(--color-danger\)/);
  });
});
