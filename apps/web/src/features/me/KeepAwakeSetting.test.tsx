import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { KEEP_AWAKE_KEY } from "../../ui/keepAwake";
import { KeepAwakeSetting } from "./KeepAwakeSetting";

afterEach(() => {
  window.localStorage.removeItem(KEEP_AWAKE_KEY);
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

const supported = () => Object.defineProperty(navigator, "wakeLock", { value: { request: async () => ({}) }, configurable: true });

describe("#108 — the Profile switch", () => {
  it("is checked by default and stores off when unchecked, on this device", async () => {
    supported();
    render(<KeepAwakeSetting />);
    const box = screen.getByRole("checkbox", { name: "Keep screen on during workouts" });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription("Applies on this device.");

    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem(KEEP_AWAKE_KEY)).toBe("off");

    await userEvent.click(box);
    expect(window.localStorage.getItem(KEEP_AWAKE_KEY)).toBeNull();
  });

  it("reads a stored off", () => {
    supported();
    window.localStorage.setItem(KEEP_AWAKE_KEY, "off");
    render(<KeepAwakeSetting />);
    expect(screen.getByRole("checkbox", { name: "Keep screen on during workouts" })).not.toBeChecked();
  });

  it("says so, and is disabled, where the browser cannot keep the screen on", () => {
    render(<KeepAwakeSetting />);
    const box = screen.getByRole("checkbox", { name: "Keep screen on during workouts" });
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription("Not available in this browser.");
  });
});
