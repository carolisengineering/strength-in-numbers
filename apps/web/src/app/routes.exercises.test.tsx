import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { ChartIcon } from "../ui/icons";
import { makePersonalRecord } from "../test/workoutFixtures";
import { createWorkoutFake } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";
import { NAV_ITEMS, navItemFor } from "./navItems";

afterEach(() => cleanupApp());

const BENCH = "10000000-0000-4000-8000-0000000000b1";

function setup(path: string) {
  const fake = createWorkoutFake({
    records: [makePersonalRecord({ exerciseId: BENCH, exerciseName: "Barbell bench press", localDate: "2026-10-06" })],
  });
  prepareApp({ auth, fake });
  return renderApp(path);
}

describe("18.2 AC1 — the tab", () => {
  it("the third nav entry is Exercises with the chart icon", () => {
    expect(NAV_ITEMS[2]).toEqual({ to: "/app/exercises", label: "Exercises", icon: ChartIcon });
    for (const path of ["/app/exercises", "/app/exercises/records", "/app/exercises/x"]) {
      expect(navItemFor(path)).toBe(NAV_ITEMS[2]);
    }
  });

  it.each(["/app/exercises", "/app/exercises/records", `/app/exercises/${BENCH}`])("marks Exercises current on %s", async (path) => {
    setup(path);
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Exercises" })).toHaveAttribute("aria-current", "page"));
    expect(within(nav).queryByRole("link", { name: "Progress" })).toBeNull();
  });
});

describe("18.2 AC2 — routes", () => {
  it("records outranks :id", async () => {
    setup("/app/exercises/records");
    expect(await screen.findByRole("list", { name: "Exercises" })).toBeInTheDocument();
  });

  it("an unknown deeper path is NotFound", async () => {
    setup("/app/exercises/x/y");
    expect(await screen.findByRole("heading", { level: 1, name: /not found/i })).toBeInTheDocument();
  });
});

describe("18.2 AC3 — redirects", () => {
  it("/app/progress replaces to the Records view", async () => {
    const { router } = setup("/app/history");
    await screen.findByRole("heading", { level: 1, name: "History" });
    await router.navigate("/app/progress");
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/exercises/records"));
    expect(router.state.historyAction).toBe("REPLACE");
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
  });

  it("/app/progress/:id keeps the id as one encoded segment", async () => {
    const { router } = setup("/app/progress/a%2Fb");
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/exercises/a%2Fb"));
    expect(router.state.historyAction).toBe("REPLACE");
  });
});
