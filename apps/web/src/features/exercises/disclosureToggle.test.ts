import { describe, expect, it, vi } from "vitest";
import { disclosureToggle } from "./disclosureToggle";

/** A toggle event as React hands it to the outer `<details>`: `currentTarget` is the outer one, `target` where it fired. */
const toggleFrom = (target: object, outer: { open: boolean }) => ({ target, currentTarget: outer }) as unknown as React.SyntheticEvent<HTMLDetailsElement>;

describe("minor 508 — the exercise page's disclosure ignores a nested toggle", () => {
  it("a nested <details> toggling leaves the outer disclosure's state alone", () => {
    const setOpen = vi.fn();
    const outer = { open: false };
    disclosureToggle(true, setOpen)(toggleFrom({ open: true }, outer));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("the disclosure's own toggle records the lifter's change", () => {
    const setOpen = vi.fn();
    const outer = { open: false };
    disclosureToggle(true, setOpen)(toggleFrom(outer, outer));
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("a toggle the page made itself (the open state already matches) records nothing", () => {
    const setOpen = vi.fn();
    const outer = { open: true };
    disclosureToggle(true, setOpen)(toggleFrom(outer, outer));
    expect(setOpen).not.toHaveBeenCalled();
  });
});
