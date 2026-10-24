import { act, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { editDoneButton } from "../../../test/sessionHelpers";
import { formatStartedAt } from "../format";
import { EDIT_COPY } from "./editCopy";

afterEach(() => {
  observability.track.mockReset();
  focusManager.setFocused(undefined);
  cleanupApp();
});

const simple = () =>
  makeWorkoutDetail({
    startedAt: "2026-10-02T10:00:00.000Z",
    endedAt: "2026-10-02T10:52:00.000Z",
    localDate: "2026-10-02",
    routineName: "Push Day",
    routineNotes: "Go heavy today",
    exercises: [
      { modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, setType: "warmup", weight: 40 }), makeSet({ setNumber: 2, weight: 80, reps: 5 })] },
      { modality: "weight_reps", name: "Overhead Press", sets: [makeSet({ setNumber: 1, weight: 40, reps: 8 })] },
    ],
  });

/** Superset + sections, with a loose tail and a section that is not contiguous (07.4 §6.9). */
const structured = () =>
  makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    sections: [{ name: "Warm-up", notes: "Easy pace" }, { name: "Main" }],
    exercises: [
      { modality: "weight_reps", name: "Goblet Squat", sectionIndex: 0, sets: [makeSet({ setNumber: 1, setType: "warmup", weight: 20 })] },
      { modality: "weight_reps", name: "Bench Press", sectionIndex: 1, supersetGroup: 1, targetSets: 3, targetRepsLow: 5, targetRepsHigh: 5, sets: [makeSet({ setNumber: 1 })] },
      { modality: "weight_reps", name: "Barbell Row", sectionIndex: 1, supersetGroup: 1, sets: [makeSet({ setNumber: 1, reps: 10 })] },
      { modality: "bodyweight_reps", name: "Dips", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, reps: 12 })] },
      { modality: "weight_reps", name: "Face Pull", sectionIndex: 0, sets: [makeSet({ setNumber: 1, reps: 15 })] },
    ],
  });

function open(workout = simple(), section: "workouts" | "history" = "history") {
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/${section}/${workout.id}/edit`);
  return { fake, workout, ...app };
}
const ready = () => screen.findByRole("heading", { level: 1, name: "Edit workout" });

describe("18.0 AC3 — banner, header, Done", () => {
  it("h1, the banner from localDate, the device-zone header, and Done as the only primary", async () => {
    const { workout } = open();
    await ready();
    const banner = screen.getByText("Editing Fri 2 Oct workout");
    expect(banner).not.toHaveAttribute("role");
    expect(banner).not.toHaveAttribute("aria-live");
    expect(screen.getByText(`Started ${formatStartedAt(workout.startedAt)} · Took 52 min`)).toBeInTheDocument();
    const primaries = [...document.querySelectorAll("button")].filter((b) => /_primary_/.test(b.className) && !b.closest("dialog"));
    expect(primaries).toEqual([editDoneButton()]);
    expect(editDoneButton()).toHaveTextContent("Done");
  });
});

describe("18.0 AC4 — what edit mode does not have", () => {
  it("no menu, discard, end early, finish, bar, sync line, rest, announcements, entry row, pending tags, routine note or collapsed cards", async () => {
    open();
    await ready();
    for (const name of ["Workout menu", "Discard workout", "End workout early", "Finish workout"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    for (const id of ["session-bar", "sync-status", "rest-line-slot", "session-announcement"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);
    for (const article of articles) {
      expect(article.querySelector("form")).toBeNull();
      expect(article.querySelector("h2 button")).toBeNull();
      expect(within(article).getAllByRole("listitem").length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Not saved yet")).toBeNull();
    expect(screen.queryByText("Go heavy today")).toBeNull();
  });
});

describe("18.0 AC5 — the cards are those of the logging screen", () => {
  it("sections with notes, superset brackets, target lines; each card's set rows read as on the summary", async () => {
    const workout = structured();
    const { user } = open(workout);
    await ready();
    expect(screen.getAllByRole("heading", { name: "Warm-up" })).toHaveLength(2); // the section is not contiguous
    expect(screen.getByText("Easy pace")).toBeInTheDocument();
    expect(document.querySelector('[data-bracket="first"]')).not.toBeNull();
    expect(screen.getByText(/3 × 5/)).toBeInTheDocument();
    // Each exercise's set rows, read from the card (edit) or section (summary) that its h2 heads.
    const rowsOn = () =>
      Object.fromEntries(
        workout.exercises.map((e) => {
          const owner = screen.getByRole("heading", { level: 2, name: e.exerciseNameSnapshot }).closest("article, section")!;
          return [e.exerciseNameSnapshot, [...owner.querySelectorAll("li")].map((li) => li.textContent)];
        }),
      );
    const editRows = rowsOn();
    expect(Object.values(editRows).every((rows) => rows.length === 1)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(rowsOn()).toEqual(editRows);
  });
});

describe("18.0 AC13 — Done", () => {
  it.each(["workouts", "history"] as const)("returns (replace) to /app/%s/:id with no request", async (section) => {
    const { fake, workout, user, router } = open(simple(), section);
    await ready();
    const count = fake.requests.length;
    await user.click(editDoneButton());
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${section}/${workout.id}`));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(fake.requests.slice(count).filter((r) => r.method !== "GET")).toEqual([]);
  });
});

describe("18.0 AC15 — offline open", () => {
  it("renders the cached cards with the refresh-failed notice", async () => {
    const workout = simple();
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { router } = renderApp(`/app/history/${workout.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    fake.setOffline(true);
    await act(() => router.navigate(`/app/history/${workout.id}/edit`));
    await ready();
    expect(await screen.findByText(EDIT_COPY.refreshFailed)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("deferred minor 10: with the browser itself offline (airplane mode) the notice shows too", async () => {
    const workout = simple();
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { router } = renderApp(`/app/history/${workout.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    fake.setOffline(true);
    onlineManager.setOnline(false);
    try {
      await act(() => router.navigate(`/app/history/${workout.id}/edit`));
      await ready();
      expect(await screen.findByText(EDIT_COPY.refreshFailed)).toBeInTheDocument();
      expect(screen.getAllByRole("article")).toHaveLength(2);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe("18.0 AC15 — a failed refresh does not hide the summary (final review #1)", () => {
  it("Done after a failed edit-screen refresh shows the cached summary, not the load error", async () => {
    const workout = simple();
    const fake = createWorkoutFake({ finished: [workout] });
    prepareApp({ auth, fake });
    const { user } = renderApp(`/app/history/${workout.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    fake.failNext({ method: "GET", path: new RegExp(`^/v1/workouts/${workout.id}$`) }, () => problemResponse(500, "about:blank"), 3);
    await user.click(screen.getByRole("button", { name: "Edit workout" }));
    expect(await screen.findByText(EDIT_COPY.refreshFailed)).toBeInTheDocument();
    await user.click(editDoneButton());
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(screen.queryByText(EDIT_COPY.loadFailed)).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Bench Press" })).toBeInTheDocument();
  });
});

describe("18.0 AC20 — the workout vanished on refetch", () => {
  it("a refetch 404 replaces the screen with the notice and a link home", async () => {
    const { fake, workout } = open();
    await ready();
    fake.state.finished.delete(workout.id);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText(EDIT_COPY.vanished)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to History" })).toHaveAttribute("href", "/app/history");
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("18.0 AC27 — workout_edit_opened", () => {
  it("is tracked once per mount with the section", async () => {
    open(simple(), "workouts");
    await ready();
    expect(observability.track.mock.calls.filter(([name]) => name === "workout_edit_opened")).toEqual([["workout_edit_opened", { section: "workouts" }]]);
  });
});

const markerSources = import.meta.glob(["../FinishedWorkoutScreen.tsx", "../../history/HistoryRow.tsx", "../../progress/**/*.tsx", "!../../progress/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("18.0 AC28 — no marker", () => {
  it("the summary, the History row and Progress read no updatedAt and say nothing like 'edited'", () => {
    expect(Object.keys(markerSources).length).toBeGreaterThan(3);
    for (const [path, source] of Object.entries(markerSources)) {
      expect([path, /updatedAt/.test(source)]).toEqual([path, false]);
      expect([path, /edited|logged later/i.test(source)]).toEqual([path, false]);
    }
  });
});
