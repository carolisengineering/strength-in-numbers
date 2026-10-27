import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
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

import { makeExercise } from "../../test/catalogFixtures";
import { makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISE_LIMIT_MESSAGE } from "../catalog/fieldErrors";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, exercisePath } from "./paths";

afterEach(() => cleanupApp());

const ID = "10000000-0000-4000-8000-0000000000e1";
const plank = makeExercise({ id: ID, name: "Plank", ownerUserId: null, modality: "duration" });
const FORK = /^\/v1\/exercises\/[^/]+\/fork$/;

function setup(fakeOptions: WorkoutFakeOptions = {}) {
  const fake = createWorkoutFake({ serveExercises: true, catalog: [plank], usage: [], progress: { [ID]: [makeProgressPoint()] }, ...fakeOptions });
  prepareApp({ auth, fake, catalog: [plank] });
  return { fake, ...renderApp("/app/history") };
}
const forks = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "POST" && FORK.test(r.path));
const copyButton = () => screen.findByRole("button", { name: EXERCISES_COPY.makeCopy });

async function openPlank(router: ReturnType<typeof setup>["router"]) {
  await screen.findByRole("heading", { level: 1, name: "History" });
  await router.navigate(exercisePath(ID));
  await screen.findByRole("heading", { level: 1, name: "Plank" });
}

describe("18.2 AC43 — the flow", () => {
  it("a bodiless fork lands on the copy with the notice, focus on its title, and the built-in gone from the list", async () => {
    const { fake, router, user } = setup();
    await openPlank(router);
    await user.click(await copyButton());
    await waitFor(() => expect(forks(fake)).toHaveLength(1));
    expect(forks(fake)[0]!.path).toBe(`/v1/exercises/${ID}/fork`);
    expect(forks(fake)[0]!.body).toBeUndefined();
    const copy = fake.state.catalog.find((e) => e.forkedFromExerciseId === ID)!;
    await waitFor(() => expect(router.state.location.pathname).toBe(exercisePath(copy.id)));
    expect(await screen.findByText(EXERCISES_COPY.copyReady)).toHaveAttribute("role", "status");
    await waitFor(() => expect((router.state.location.state as { notice?: string } | null)?.notice).toBeUndefined());
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("Plank");
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).not.toBe(exercisePath(copy.id)));
    expect(router.state.location.pathname).not.toBe(exercisePath(ID));
    await router.navigate(EXERCISES_PATH);
    const list = await screen.findByRole("list", { name: EXERCISES_COPY.listLabel });
    const links = list.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual([exercisePath(copy.id)]);
  });
});

describe("18.2 AC44 — disabled on tap", () => {
  it("two taps in one tick send one fork; the button stays disabled until it settles and comes back after a failure", async () => {
    const { fake, router } = setup();
    await openPlank(router);
    fake.failNext({ method: "POST", path: FORK }, () => problemResponse(500, "internal"));
    const button = await copyButton();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(button).toBeDisabled();
    await waitFor(() => expect(screen.getByText(EXERCISES_COPY.couldntSave)).toBeInTheDocument());
    expect(forks(fake)).toHaveLength(1);
    expect(await copyButton()).toBeEnabled();
  });
});

describe("18.2 AC45 — copy errors", () => {
  it("the cap: its text above the button, which keeps its place", async () => {
    const { router, user } = setup({ customLimit: 0 });
    await openPlank(router);
    await user.click(await copyButton());
    const notice = await screen.findByText(EXERCISE_LIMIT_MESSAGE);
    const button = await copyButton();
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("404: no longer available, after a forced refresh", async () => {
    const { fake, router, user } = setup();
    await openPlank(router);
    fake.failNext({ method: "POST", path: FORK }, () => problemResponse(404, "not-found"));
    const syncsBefore = fake.requests.length;
    await user.click(await copyButton());
    expect(await screen.findByText(EXERCISES_COPY.forkGone)).toBeInTheDocument();
    expect(fake.requests.slice(syncsBefore).some((r) => r.method === "GET" && r.path === "/v1/exercises")).toBe(true);
  });

  it("offline: the offline text", async () => {
    const { fake, router, user } = setup();
    await openPlank(router);
    fake.failNext({ method: "POST", path: FORK }, () => HttpResponse.error());
    await user.click(await copyButton());
    expect(await screen.findByText(EXERCISES_COPY.offline)).toBeInTheDocument();
  });
});
