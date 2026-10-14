import { screen } from "@testing-library/react";
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

import { SECTION_EMPTY_HINT } from "./messages";
import { markupOf } from "../../test/markup";
import { routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { catalog, pushA, pushSectioned } from "../../test/routineFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

const EDIT_A = `/app/workouts/routines/${routineId(1)}/edit`;

/** The page itself is a labelled `<section>` (the Screen shell); only the routine's own section regions count here. */
const sectionRegions = () => screen.queryAllByRole("region").filter((r) => !/^(Edit|New) routine$/.test(r.getAttribute("aria-label") ?? r.querySelector("h1")?.textContent ?? ""));

async function open(
  path: string,
  routines = [pushA, pushSectioned],
  ready: () => Promise<unknown> = () => screen.findByLabelText("Name"),
) {
  const fake = createWorkoutFake({ catalog, routines });
  prepareApp({ auth, catalog, fake });
  const app = renderApp(path);
  await ready();
  return { fake, ...app };
}

describe("10.3 AC14 — a section-free routine looks exactly as in 10.2", () => {
  it("the exercise list markup is unchanged (baseline recorded before Spec 10.3's edits)", async () => {
    await open(EDIT_A);
    expect(markupOf(screen.getByRole("list", { name: "Exercises" }))).toMatchSnapshot();
    expect(sectionRegions()).toEqual([]);
    expect(screen.queryByText(SECTION_EMPTY_HINT)).toBeNull();
  });
});
