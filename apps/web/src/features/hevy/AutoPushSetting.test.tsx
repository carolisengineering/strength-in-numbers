import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { routes } from "../../app/router";
import { ME, ME_URL, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, setInstantPacing, userInfoOk } from "../../test/hevyHarness";
import { server } from "../../test/msw/server";
import { catalogHandlers, createWorkoutFake } from "../../test/workoutFake";
import { HEVY_AUTO_PUSH_KEY } from "../../ui/hevyAutoPush";
import { hevyKeyStore } from "./keyStore";
import { HEVY_PATH } from "./paths";

const LABEL = "Send each workout to Hevy when I finish it";
const HELP = "Works while the app is open. If something can't be sent, the workout's screen has a Send to Hevy button.";

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  window.localStorage.clear();
  server.use(userInfoOk());
});
afterEach(() => {
  clearHevyKey();
  window.localStorage.clear();
  unstubAccountEnv();
});

describe("20.2 AC23 — the switch", () => {
  it("with a key: a checkbox, off by default, described by the help sentence", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    renderHevyScreen();
    const box = await screen.findByRole("checkbox", { name: LABEL });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(HELP);
  });

  it("toggling stores \"on\"; toggling back removes it", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    renderHevyScreen();
    const box = await screen.findByRole("checkbox", { name: LABEL });
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(window.localStorage.getItem(HEVY_AUTO_PUSH_KEY)).toBe("on");
    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem(HEVY_AUTO_PUSH_KEY)).toBeNull();
  });

  it("a stored \"on\" shows checked", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    window.localStorage.setItem(HEVY_AUTO_PUSH_KEY, "on");
    renderHevyScreen();
    expect(await screen.findByRole("checkbox", { name: LABEL })).toBeChecked();
  });

  it("no key: no switch", async () => {
    renderHevyScreen();
    expect(await screen.findByLabelText("Hevy API key")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
  });

  it("Remove the key: the switch goes, the stored \"on\" stays", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    window.localStorage.setItem(HEVY_AUTO_PUSH_KEY, "on");
    renderHevyScreen();
    await screen.findByRole("checkbox", { name: LABEL });
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByLabelText("Hevy API key")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
    expect(window.localStorage.getItem(HEVY_AUTO_PUSH_KEY)).toBe("on");
  });

  it("structure: the label wraps the input, and the row is a full tap target", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    renderHevyScreen();
    const box = await screen.findByRole("checkbox", { name: LABEL });
    expect(box.closest("label")).not.toBeNull();
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "AutoPushSetting.module.css"), "utf8");
    expect(css).toMatch(/\.row\s*\{[^}]*min-height:\s*var\(--tap-target-min\)/);
  });
});

describe("20.2 AC23 — not the owner", () => {
  it("a 404 status is the not-found screen, so no switch", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    server.use(...createWorkoutFake().handlers, ...catalogHandlers([]), http.get(ME_URL, () => HttpResponse.json(ME)));
    const router = createMemoryRouter(routes, { initialEntries: [HEVY_PATH] });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
  });
});
