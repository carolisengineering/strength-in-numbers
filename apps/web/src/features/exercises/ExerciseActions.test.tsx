import { screen, within } from "@testing-library/react";
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

import type { Exercise } from "@sin/core";
import { USER_ID } from "../../test/catalogHarness";
import { makeExercise } from "../../test/catalogFixtures";
import { makePersonalRecord, makeProgressPoint } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { EXERCISES_COPY } from "./messages";
import { exercisePath } from "./paths";

afterEach(() => cleanupApp());

const BUILT_IN = "10000000-0000-4000-8000-0000000000d1";
const OWN = "10000000-0000-4000-8000-0000000000d2";
const COPY = "10000000-0000-4000-8000-0000000000d3";
const GONE = "10000000-0000-4000-8000-0000000000d4";
const builtIn = makeExercise({ id: BUILT_IN, name: "Plank", ownerUserId: null, modality: "duration" });
const own = makeExercise({ id: OWN, name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });
const otherBuiltIn = makeExercise({ id: "10000000-0000-4000-8000-0000000000d5", name: "Bench Press", ownerUserId: null });
const copy = makeExercise({ id: COPY, name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: otherBuiltIn.id });

function setup(id: string, catalog: Exercise[] = [builtIn, own, otherBuiltIn, copy]) {
  const fake = createWorkoutFake({
    serveExercises: true,
    catalog,
    usage: [],
    progress: { [GONE]: [makeProgressPoint()] },
    records: [makePersonalRecord({ exerciseId: GONE, exerciseName: "Old lift" })],
  });
  prepareApp({ auth, fake, catalog });
  return renderApp(exercisePath(id));
}

const page = (name: string) => screen.findByRole("region", { name });
const pageButtons = async (name: string) =>
  within(await page(name))
    .queryAllByRole("button")
    .filter((b) => b.closest("[role='group'], ul[aria-label='Sessions']") === null);

describe("18.2 AC34 — which actions show", () => {
  it("own exercise: Edit and Delete exercise, both secondary", async () => {
    setup(OWN);
    await screen.findByRole("heading", { level: 1, name: "Echo Bike" });
    const buttons = await pageButtons("Echo Bike");
    expect(buttons.map((b) => b.textContent)).toEqual(["Edit", "Delete exercise"]);
    for (const b of buttons) expect(b.className).toMatch(/secondary/);
  });

  it("a copy: the same", async () => {
    setup(COPY);
    await screen.findByRole("heading", { level: 1, name: "My bench" });
    expect((await pageButtons("My bench")).map((b) => b.textContent)).toEqual(["Edit", "Delete exercise"]);
  });

  it("a built-in: the note and Make your own copy", async () => {
    setup(BUILT_IN);
    await screen.findByRole("heading", { level: 1, name: "Plank" });
    expect(screen.getByText(EXERCISES_COPY.builtInNote)).toBeInTheDocument();
    const buttons = await pageButtons("Plank");
    expect(buttons.map((b) => b.textContent)).toEqual(["Make your own copy"]);
    expect(buttons[0]!.className).toMatch(/secondary/);
  });

  it("the deleted variant: none", async () => {
    setup(GONE);
    await screen.findByRole("heading", { level: 1, name: "Old lift" });
    await screen.findByText(EXERCISES_COPY.deleted);
    expect(await pageButtons("Old lift")).toEqual([]);
  });
});
