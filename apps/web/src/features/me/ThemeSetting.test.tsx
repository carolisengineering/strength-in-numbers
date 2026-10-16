import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localStorageAdapter } from "../../storage/storage";
import { THEME_KEY } from "../../ui/theme";
import { ThemeSetting } from "./ThemeSetting";

const storage = localStorageAdapter();

beforeEach(() => storage.remove(THEME_KEY));
afterEach(() => {
  storage.remove(THEME_KEY);
  delete document.documentElement.dataset.theme;
});

describe("AC21 — the switch renders and is accessible", () => {
  it("is one labeled group of Light, Dark, System radios with System checked by default", () => {
    render(<ThemeSetting />);
    // The fieldset and its legend are the one labeled group; native radios need no extra radiogroup role.
    const group = screen.getByRole("group", { name: "Theme" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(["Light", "Dark", "System"]);
    expect(within(group).getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByText("Applies on this device.")).toBeInTheDocument();
  });

  it("starts on the stored choice", () => {
    storage.set(THEME_KEY, "dark");
    render(<ThemeSetting />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("gives every option at least the 44 px tap target", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ThemeSetting.module.css"), "utf8");
    expect(/\.option\s*\{[^}]*min-height:\s*var\(--tap-target-min\)[^}]*min-width:\s*var\(--tap-target-min\)/.test(css)).toBe(true);
  });
});

describe("AC22 — choosing applies and persists", () => {
  it("Dark then System: sets, then clears, the attribute and the stored key", async () => {
    const user = userEvent.setup();
    render(<ThemeSetting />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storage.get(THEME_KEY)).toBe("dark");

    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(storage.get(THEME_KEY)).toBeNull();
  });
});
