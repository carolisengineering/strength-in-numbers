import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, useInstantPacer, userInfoOk } from "../../test/hevyHarness";
import { server } from "../../test/msw/server";
import { filesUnder } from "../../test/sourceScan";
import { hevyKeyStore } from "./keyStore";
import { HEVY_COPY, KEY_SAVED, KEY_SHAPE_ERROR } from "./messages";

const HERE = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  useInstantPacer();
  clearHevyKey();
  window.localStorage.clear();
});
afterEach(() => {
  clearHevyKey();
  window.localStorage.clear();
  unstubAccountEnv();
});

describe("20.0 AC32 — Hevy screen landmarks and live regions", () => {
  it("one h1 'Hevy', then an h2 'Hevy key', in a labelled region", () => {
    renderHevyScreen();
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => [h.tagName, h.textContent])).toEqual([
      ["H1", "Hevy"],
      ["H2", "Hevy key"],
    ]);
    expect(screen.getByRole("region", { name: "Hevy" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Hevy key" })).toBeInTheDocument();
  });

  it("every status region is polite and empty at first paint, and every button is named", () => {
    renderHevyScreen();
    const statuses = screen.getAllByRole("status");
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(s).toBeEmptyDOMElement();
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAccessibleName();
  });

  it("focus moves to the status line after Save and after Remove", async () => {
    server.use(userInfoOk());
    renderHevyScreen();
    await userEvent.click(screen.getByLabelText("Hevy API key"));
    await userEvent.paste(VALID_KEY);
    const line = screen.getByTestId("hevy-key-status");
    // Focus arrives with the words, never on an empty line.
    let textWhenFocused: string | null = null;
    line.addEventListener("focus", () => void (textWhenFocused = line.textContent), { once: true });
    await userEvent.click(screen.getByRole("button", { name: "Save and remember" }));
    await waitFor(() => expect(line).toHaveTextContent(KEY_SAVED));
    await waitFor(() => expect(line).toHaveFocus());
    expect(textWhenFocused).toBe(KEY_SAVED);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(line).toHaveFocus());
    expect(hevyKeyStore.get(USER_ID)).toBeNull();
  });

  it("a failure is a sentence, never color alone, and is tied to the field", async () => {
    renderHevyScreen();
    await userEvent.click(screen.getByLabelText("Hevy API key"));
    await userEvent.paste("abc");
    await userEvent.click(screen.getByRole("button", { name: "Save and remember" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(KEY_SHAPE_ERROR);
    expect(screen.getByLabelText("Hevy API key")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Hevy API key").getAttribute("aria-describedby")).toContain(alert.id);
    expect(Object.values(HEVY_COPY).every((s) => /[a-z]/i.test(s))).toBe(true);
  });
});

describe("20.0 AC14 — the screen shell", () => {
  it("is a Screen titled Hevy with Back to Profile and the key card; with a stored key it works without the network", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    server.use(userInfoOk());
    renderHevyScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Hevy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Profile" })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByRole("region", { name: "Hevy key" })).toBeInTheDocument();
    expect(screen.getByText("Hevy key ending ••••beef")).toBeInTheDocument();
  });

  it("the Profile row is a full-height tap target (the token, not a number)", () => {
    const css = readFileSync(join(HERE, "HevyProfileRow.module.css"), "utf8");
    expect(css).toContain("min-height: var(--tap-target-min)");
  });
});

describe("20.0 AC16 — tokens and roles", () => {
  const sheets = filesUnder(HERE, /\.module\.css$/).map((path) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));

  it("the Hevy stylesheets write no design value of their own", () => {
    expect(sheets.length).toBeGreaterThan(0);
    for (const css of sheets) {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\b\d+(\.\d+)?px\b/);
      expect(css).not.toMatch(/\b(rgb|hsl)a?\(/i);
    }
  });

  it("no brass, and no teal outside the primary button", () => {
    for (const css of sheets) {
      expect(css).not.toContain("--color-pr");
      expect(css).not.toContain("--color-signal");
    }
  });
});
