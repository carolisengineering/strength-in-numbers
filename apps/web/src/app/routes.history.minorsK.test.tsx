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

import { resetDesktop, setDesktop } from "../test/desktop";
import { makeSet, makeWorkoutDetail } from "../test/workoutFixtures";
import { createWorkoutFake } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";

afterEach(() => {
  resetDesktop();
  cleanupApp();
});

const finished = (n: number, title: string) =>
  makeWorkoutDetail({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title,
    startedAt: `2026-10-${String(n).padStart(2, "0")}T18:00:00.000Z`,
    endedAt: `2026-10-${String(n).padStart(2, "0")}T19:00:00.000Z`,
    localDate: `2026-10-${String(n).padStart(2, "0")}`,
    exercises: [{ modality: "weight_reps", name: "Bench press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] }],
  });
const OLDER = finished(2, "Older pull");
const NEWER = finished(5, "Newer push");

async function deleteFrom(path: string, wide: boolean) {
  if (wide) setDesktop(true);
  const fake = createWorkoutFake({ finished: [OLDER, NEWER], active: null });
  prepareApp({ auth, fake });
  const app = renderApp("/app/history");
  // Opened from the list: /app/history, then /app/history/:id pushed on top of it.
  await app.router.navigate(path);
  // At desktop widths the list row also says "Newer push", so wait for the summary's own menu, not the text.
  // Minor 730: this file's first test pays for the app's first render; on a slow CI runner under coverage the
  // menu's items arrived after Testing Library's default 1 s, so both waits get the suite's usual 5 s.
  await app.user.click(await screen.findByRole("button", { name: "Workout menu" }, { timeout: 5000 }));
  await app.user.click(await screen.findByRole("button", { name: "Delete workout" }, { timeout: 5000 }));
  await app.user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/app/history"));
  return app;
}

describe("minor 654 — a delete from /app/history/:id replaces its entry, so Back never lands on the deleted workout", () => {
  it.each([
    ["at desktop widths", true],
    ["on a phone", false],
  ])("%s", async (_label, wide) => {
    const { router } = await deleteFrom(`/app/history/${NEWER.id}`, wide);
    expect(router.state.historyAction).toBe("REPLACE");
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).not.toBe(`/app/history/${NEWER.id}`));
  });
});
