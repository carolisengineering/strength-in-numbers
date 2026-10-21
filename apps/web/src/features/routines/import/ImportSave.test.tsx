import type { RoutineWrite } from "@sin/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));

import { API_BASE_URL } from "../../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { importCatalog, toEditor } from "../../../test/importFixtures";
import { server } from "../../../test/msw/server";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { routes } from "../../../app/router";
import { cleanupApp, deferred, makeQueryClient, prepareApp, renderApp } from "../../../test/workoutHarness";
import { OFFLINE_SAVE, SAVE_FAILED } from "../messages";
import { IMPORT_PATH } from "../paths";
import { EXERCISE_LIMIT, createFailed } from "./messages";

const EXERCISES = /^\/v1\/exercises$/;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  observability.track.mockReset();
});
afterEach(() => cleanupApp());

function start(catalog = [...importCatalog]) {
  const fake = createWorkoutFake({ catalog, serveExercises: true });
  prepareApp({ auth, fake, catalog });
  const app = renderApp(IMPORT_PATH);
  const posts = () => fake.requests.filter((r) => r.method === "POST").map((r) => r.path);
  const exercisePosts = () => fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/exercises").map((r) => (r.body as { name: string }).name);
  return { fake, posts, exercisePosts, ...app };
}

const save = () => screen.getByRole("button", { name: "Save" });

describe("10.4 AC31 — Save creates the new exercises, then the routine", () => {
  it("request order, bodies from the cards, real ids only, then the preview", async () => {
    const { user, fake, posts } = start();
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByRole("heading", { level: 1, name: "Second Shift" })).toBeInTheDocument();
    expect(posts()).toEqual(["/v1/exercises", "/v1/exercises", "/v1/exercises", "/v1/routines"]);
    expect(fake.requests.filter((r) => r.path === "/v1/exercises" && r.method === "POST").map((r) => r.body)).toEqual(
      ["Hand Release Pushups", "Front Raise", "Reverse Fly"].map((name, i) => ({
        name,
        modality: i === 0 ? "bodyweight_reps" : "weight_reps",
        primaryMuscleId: null,
        secondaryMuscleIds: [],
        equipmentId: null,
      })),
    );
    const ids = (fake.requests.find((r) => r.path === "/v1/routines" && r.method === "POST")!.body as RoutineWrite).items.map((i) => i.exerciseId);
    expect(ids.every((id) => fake.state.catalog.some((e) => e.id === id))).toBe(true);
  });

  it("no pending exercises: exactly today's single write", async () => {
    const extra = ["Hand Release Pushups", "Front Raise", "Reverse Fly"].map((name, i) => makeExercise({ id: exerciseId(40 + i), name, primaryMuscleId: null, equipmentId: null }));
    const { user, posts } = start([...importCatalog, ...extra]);
    await toEditor(user);
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(posts()).toEqual(["/v1/routines"]);
  });

  it("Save is busy and the form locked while exercises are created (Review Focus 2)", async () => {
    const { user, posts } = start();
    const held = deferred<void>();
    let first = true;
    server.use(
      http.post(`${API_BASE_URL}/v1/exercises`, async () => {
        if (!first) return undefined;
        first = false;
        await held.promise;
        return undefined; // falls through to the fake's handler
      }),
    );
    await toEditor(user);
    await user.click(save());
    await waitFor(() => expect(save()).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByLabelText("Name")).toBeDisabled();
    await user.click(save());
    held.resolve();
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(posts()).toEqual(["/v1/exercises", "/v1/exercises", "/v1/exercises", "/v1/routines"]);
  });
});

describe("10.4 AC32 — failures keep the draft; retries create nothing twice", () => {
  it("the 2nd create fails: message, Save reopens, retry creates the rest only", async () => {
    const { user, fake, exercisePosts } = start();
    fake.failNext({ method: "POST", path: EXERCISES }, () => problemResponse(500, "about:blank"), 1, 1);
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByText(createFailed("Front Raise"))).toBeInTheDocument();
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(exercisePosts()).toEqual(["Hand Release Pushups", "Front Raise", "Front Raise", "Reverse Fly"]);
  });

  it("the routine write fails after the creates: the retry reuses them", async () => {
    const { user, fake, exercisePosts } = start();
    fake.failNext({ method: "POST", path: /^\/v1\/routines$/ }, () => problemResponse(500, "about:blank"));
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument();
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    expect(exercisePosts()).toEqual(["Hand Release Pushups", "Front Raise", "Reverse Fly"]);
  });

  it("a lost create response: offline message; the retry refreshes and reuses by name", async () => {
    const { user, fake, exercisePosts } = start();
    fake.loseNextResponse({ method: "POST", path: EXERCISES });
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByText(OFFLINE_SAVE)).toBeInTheDocument();
    await waitFor(() => expect(save()).toBeEnabled());
    const before = fake.requests.length;
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    const after = fake.requests.slice(before);
    expect(after.findIndex((r) => r.method === "GET" && r.path === "/v1/exercises")).toBeLessThan(after.findIndex((r) => r.method === "POST"));
    expect(exercisePosts()).toEqual(["Hand Release Pushups", "Front Raise", "Reverse Fly"]);
  });

  it("the custom-exercise cap", async () => {
    const { user, fake, posts } = start();
    fake.failNext({ method: "POST", path: EXERCISES }, () => problemResponse(409, "exercise-limit-reached"));
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByText(EXERCISE_LIMIT)).toBeInTheDocument();
    expect(posts()).toEqual(["/v1/exercises"]);
  });
});

describe("10.4 AC36 — observability", () => {
  it("custom_exercise_created once per create, no new event", async () => {
    const { user } = start();
    await toEditor(user);
    await user.click(save());
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    const names = observability.track.mock.calls.map((c) => c[0] as string);
    expect(names.filter((n) => n === "custom_exercise_created")).toHaveLength(3);
    for (const name of names) expect(["custom_exercise_created", "catalog_reset", "exercise_picked", "routine_saved"]).toContain(name);
  });
});

describe("10.4 AC31 — Save works under React StrictMode (the app's root)", () => {
  it("the double-mounted editor still creates the exercises and the routine", async () => {
    const fake = createWorkoutFake({ catalog: [...importCatalog], serveExercises: true });
    prepareApp({ auth, fake, catalog: [...importCatalog] });
    const router = createMemoryRouter(routes, { initialEntries: [IMPORT_PATH] });
    render(
      <StrictMode>
        <QueryClientProvider client={makeQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
    const user = userEvent.setup();
    await toEditor(user);
    await user.click(save());
    expect(await screen.findByRole("heading", { level: 1, name: "Second Shift" })).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual(["/v1/exercises", "/v1/exercises", "/v1/exercises", "/v1/routines"]);
  });
});
