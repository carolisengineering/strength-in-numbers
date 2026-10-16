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

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

type Fake = ReturnType<typeof createWorkoutFake>;
const card = () => screen.getByRole("article", { name: "X" });
const bodiesOf = (fake: Fake, method: string, path: RegExp) =>
  fake.requests.filter((r) => r.method === method && path.test(r.path)).map((r) => r.body as Record<string, unknown>);

async function active(rpe: number | null) {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({
      exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8, rpe })] }],
    }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("17.1 AC1 — no RPE control in the entry row or the set edit sheet", () => {
  it("the entry row has no RPE field and no More disclosure", async () => {
    await active(null);
    const row = within(card());
    expect(row.queryByLabelText(/RPE/)).toBeNull();
    expect(row.queryByText(/RPE|^More$/)).toBeNull();
    expect(card().querySelector("details, summary")).toBeNull();
  });

  it("the set edit sheet has no RPE field and no More disclosure, even for a set that has one", async () => {
    const { user } = await active(8);
    await user.click(within(card()).getByRole("button", { name: /60 kg × 8/ }));
    const sheet = screen.getByRole("dialog", { name: "Set 1 · X" });
    expect(within(sheet).getByLabelText("Reps")).toHaveValue("8"); // the sheet is open and populated
    expect(within(sheet).queryByLabelText(/RPE/)).toBeNull();
    expect(within(sheet).queryByText(/RPE|^More$/)).toBeNull();
    expect(sheet.querySelector("details, summary")).toBeNull();
  });
});

describe("17.1 AC2 — an edit never clears a stored RPE, and a fresh log carries none", () => {
  it("editing the reps of a set with rpe 8 sends { reps } and no rpe key", async () => {
    const { fake, user } = await active(8);
    await user.click(within(card()).getByRole("button", { name: /60 kg × 8/ }));
    const reps = within(screen.getByRole("dialog", { name: "Set 1 · X" })).getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "9");
    await user.click(within(screen.getByRole("dialog", { name: "Set 1 · X" })).getByRole("button", { name: "Save" }));

    expect(await within(card()).findByText("60 kg × 9")).toBeInTheDocument();
    const patches = bodiesOf(fake, "PATCH", /\/sets\//);
    expect(patches).toEqual([{ reps: 9 }]);
    expect("rpe" in patches[0]!).toBe(false);
  });

  it("a fresh log from the entry row sends no rpe key", async () => {
    const { fake, user } = await active(null);
    const row = within(card());
    // The draft is copy-forward seeded from the logged set, so replace its values.
    await user.clear(row.getByLabelText("Weight"));
    await user.type(row.getByLabelText("Weight"), "65");
    await user.clear(row.getByLabelText("Reps"));
    await user.type(row.getByLabelText("Reps"), "5");
    await user.click(row.getByRole("button", { name: "Log set" }));

    await within(card()).findByText(/65 kg × 5/);
    const posts = bodiesOf(fake, "POST", /\/sets$/);
    expect(posts).toHaveLength(1);
    expect("rpe" in posts[0]!).toBe(false);
  });
});

describe("17.1 AC3 — set rows never show RPE, in text or accessible names", () => {
  const SHOWN = /@\s?\d|RPE/i;
  const detail = (rpe: number | null) =>
    makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8, rpe })] }],
    });
  const names = (root: HTMLElement) =>
    [root, ...root.querySelectorAll<HTMLElement>("[aria-label]")].map((el) => el.getAttribute("aria-label") ?? "").join("|");

  async function render(path: (id: string) => string, rpe: number | null) {
    const d = detail(rpe);
    prepareApp({ auth, fake: createWorkoutFake({ finished: [d] }) });
    renderApp(path(d.id));
    const region = await screen.findByRole("region", { name: "X" });
    await within(region).findByText("60 kg × 8");
    return { text: region.textContent, names: names(region) };
  }

  it.each([
    ["the finished summary", (id: string) => `/app/workouts/${id}`],
    ["the History detail", (id: string) => `/app/history/${id}`],
  ])("%s renders a set with rpe 8 exactly like one with rpe null", async (_n, path) => {
    const withRpe = await render(path, 8);
    cleanupApp();
    const without = await render(path, null);
    expect(withRpe.text).not.toMatch(SHOWN);
    expect(withRpe.names).not.toMatch(SHOWN);
    expect(withRpe).toEqual(without);
  });

  it("the active card renders a set with rpe 8 exactly like one with rpe null", async () => {
    await active(8);
    const withRpe = { text: card().textContent, names: names(card()) };
    cleanupApp();
    await active(null);
    const without = { text: card().textContent, names: names(card()) };
    expect(withRpe.text).not.toMatch(SHOWN);
    expect(withRpe.names).not.toMatch(SHOWN);
    expect(withRpe).toEqual(without);
    expect(within(card()).getByRole("button", { name: /60 kg × 8$/ })).toBeInTheDocument();
  });
});
