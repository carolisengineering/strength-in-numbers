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

import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISES_COPY } from "./messages";

afterEach(() => cleanupApp());

function setup(path: string) {
  prepareApp({ auth, fake: createWorkoutFake() });
  return renderApp(path);
}

describe("18.2 AC5 — layout and view switch", () => {
  it("one Exercises heading and two view links, the current one marked", async () => {
    setup("/app/exercises/records");
    expect(await screen.findAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: EXERCISES_COPY.title })).toBeInTheDocument();
    const views = screen.getByRole("navigation", { name: "Exercise views" });
    const all = within(views).getByRole("link", { name: "All exercises" });
    const records = within(views).getByRole("link", { name: "Records" });
    expect(all).toHaveAttribute("href", "/app/exercises");
    expect(records).toHaveAttribute("href", "/app/exercises/records");
    expect(records).toHaveAttribute("aria-current", "page");
    expect(all).not.toHaveAttribute("aria-current");
  });

  it("defaults to All exercises, and switching views replaces history", async () => {
    const { router, user } = setup("/app/history");
    await screen.findByRole("heading", { level: 1, name: "History" });
    await router.navigate("/app/exercises");
    const views = await screen.findByRole("navigation", { name: "Exercise views" });
    expect(within(views).getByRole("link", { name: "All exercises" })).toHaveAttribute("aria-current", "page");
    await user.click(within(views).getByRole("link", { name: "Records" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/exercises/records"));
    expect(router.state.historyAction).toBe("REPLACE");
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
  });
});
