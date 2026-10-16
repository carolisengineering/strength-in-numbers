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

import { card } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

const warm = makeSet({ setNumber: 1, weight: 40, reps: 8, setType: "warmup" });

async function render() {
  const detail = makeWorkoutDetail({
    exercises: [
      { modality: "weight_reps", name: "X", sets: [warm, makeSet({ setNumber: 2, weight: 60, reps: 5 })] },
      { modality: "weight_reps", name: "Y" },
    ],
  });
  const fake = createWorkoutFake({ active: detail });
  prepareApp({ auth, fake });
  renderApp("/app/workouts");
  return detail;
}

describe("17.1 AC39 — reviewer notes from the 17.0 finish review", () => {
  it("(a) one primary Button outside an open dialog: the bar's", async () => {
    await render();
    await screen.findByRole("heading", { name: "Workout" });
    const primaries = [...document.querySelectorAll("button")].filter((b) => /_primary_/.test(b.className) && !b.closest("dialog"));
    expect(primaries).toHaveLength(1);
    expect(screen.getByTestId("session-bar")).toContainElement(primaries[0]!);
  });

  it("(b) the active card hides '(Warm-up)' visually and keeps it in the name, beside the W mark", async () => {
    await render();
    await screen.findByRole("heading", { name: "Workout" });
    const row = within(card("X")).getByRole("button", { name: /40 kg × 8 \(Warm-up\)$/ });
    expect(row.textContent).toMatch(/40 kg × 8 \(Warm-up\)$/); // still in the DOM text, for assistive technology
    const hidden = within(row).getByText("(Warm-up)", { exact: false });
    expect(hidden.className).toMatch(/hidden/);
    expect(row.querySelector('[aria-hidden="true"]')?.textContent).toBe("W");
  });
});
