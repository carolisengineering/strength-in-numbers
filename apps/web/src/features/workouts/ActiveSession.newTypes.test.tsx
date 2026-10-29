import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { onlineManager } from "@tanstack/react-query";
import { makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { card, logButton, makeCurrent } from "../../test/sessionHelpers";
import { WORKOUT_KEYS } from "./queries";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  cleanupApp();
});

type Fake = ReturnType<typeof createWorkoutFake>;
const BIKE: ExerciseSpec = { modality: "calories", name: "Bike" };
const CARRY: ExerciseSpec = { modality: "weight_distance", name: "Carry" };
const HOLD: ExerciseSpec = { modality: "weight_duration", name: "Hold" };

async function setup(exercises: ExerciseSpec[] = [BIKE, CARRY, HOLD]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const setPosts = (fake: Fake) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const field = (name: string, label: string) => within(card(name)).getByLabelText(label);
const measureKeys = (body: unknown) =>
  Object.keys(body as object).filter((k) => !["setType", "clientGeneratedId", "isComplete"].includes(k)).sort();
function goOffline(fake: Fake) {
  online = false;
  fake.setOffline(true);
  window.dispatchEvent(new Event("offline"));
}
type User = Awaited<ReturnType<typeof setup>>["user"];
async function typeInto(user: User, name: string, label: string, value: string) {
  await user.clear(field(name, label));
  await user.type(field(name, label), value);
}

describe("18.1 AC16 — logging the new types", () => {
  it("calories online: the body's only measure is calories", async () => {
    const { fake, user } = await setup();
    await makeCurrent(user, "Bike");
    await typeInto(user, "Bike", "Calories", "20");
    await user.click(logButton("Bike"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toMatchObject({ calories: 20, setType: "working", isComplete: true });
    expect(measureKeys(setPosts(fake)[0]!.body)).toEqual(["calories"]);
    expect(await within(card("Bike")).findByRole("button", { name: /20 cal/ })).toBeInTheDocument();
  });

  it("calories offline: the queued row reads 20 cal and Not saved yet", async () => {
    const { fake, user } = await setup();
    goOffline(fake);
    await makeCurrent(user, "Bike");
    await typeInto(user, "Bike", "Calories", "20");
    await user.click(logButton("Bike"));
    const row = await within(card("Bike")).findByRole("button", { name: /20 cal/ });
    expect(row).toHaveTextContent("Not saved yet");
    expect(setPosts(fake)).toHaveLength(0);
  });

  it("a replay after a lost response leaves one set", async () => {
    const { fake, user, queryClient } = await setup();
    fake.loseNextResponse({ method: "POST", path: /\/sets$/ });
    await makeCurrent(user, "Bike");
    await typeInto(user, "Bike", "Calories", "20");
    await user.click(logButton("Bike"));
    // The outbox retries after its first backoff (about a second, with jitter).
    await waitFor(() => expect(setPosts(fake).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    const keys = new Set(setPosts(fake).map((r) => (r.body as { clientGeneratedId: string }).clientGeneratedId));
    expect(keys.size).toBe(1);
    await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    await waitFor(() => expect(fake.state.active!.exercises[0]!.sets).toHaveLength(1));
    expect(within(card("Bike")).getAllByRole("button", { name: /20 cal/ })).toHaveLength(1);
  }, 15_000);

  it("a carry and a hold send their own measures; queued rows show them with canonical values", async () => {
    const { fake, user } = await setup();
    await makeCurrent(user, "Carry");
    await typeInto(user, "Carry", "Weight", "24");
    await typeInto(user, "Carry", "Distance (m)", "40");
    await user.click(logButton("Carry"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(measureKeys(setPosts(fake)[0]!.body)).toEqual(["distance", "distanceUnit", "weight", "weightUnit"]);
    goOffline(fake);
    await makeCurrent(user, "Hold");
    await typeInto(user, "Hold", "Weight", "20");
    await typeInto(user, "Hold", "Minutes", "1");
    await typeInto(user, "Hold", "Seconds", "30");
    await user.click(logButton("Hold"));
    const row = await within(card("Hold")).findByRole("button", { name: /20 kg · 1:30/ });
    expect(row).toHaveTextContent("Not saved yet");
  });

  it("Minor 95 — a hold typed as seconds only logs durationS 30", async () => {
    const { fake, user } = await setup();
    await makeCurrent(user, "Hold");
    await typeInto(user, "Hold", "Weight", "20");
    await user.clear(field("Hold", "Minutes"));
    await typeInto(user, "Hold", "Seconds", "30");
    expect(logButton("Hold")).toHaveTextContent(/20 · 0:30/);
    await user.click(logButton("Hold"));
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    expect(setPosts(fake)[0]!.body).toMatchObject({ durationS: 30, weight: 20 });
  });

  it("observability never enumerates modalities", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "observability");
    for (const name of readdirSync(dir)) {
      if (/\.tsx?$/.test(name)) expect(readFileSync(join(dir, name), "utf8")).not.toContain("distance_duration");
    }
  });
});

describe("18.1 AC16 — the bar follows the current card (Review Focus 4)", () => {
  it("from a calories card to a carry card, the bar never shows a stale label", async () => {
    const { user } = await setup();
    await makeCurrent(user, "Bike");
    await typeInto(user, "Bike", "Calories", "20");
    expect(logButton("Bike")).toHaveTextContent("Log 20 cal");
    await makeCurrent(user, "Carry");
    await typeInto(user, "Carry", "Weight", "24");
    await typeInto(user, "Carry", "Distance (m)", "40");
    expect(logButton("Carry")).toHaveTextContent("Log 24 · 40 m");
    expect(screen.getByTestId("session-bar")).not.toHaveTextContent("cal");
  });
});

describe("18.1 AC40 — feet offline", () => {
  it("a queued carry in ft shows its feet and Not saved yet", async () => {
    const { fake, user } = await setup([CARRY]);
    goOffline(fake);
    await makeCurrent(user, "Carry");
    await typeInto(user, "Carry", "Weight", "24");
    await user.click(within(card("Carry")).getByRole("button", { name: "Set options" }));
    await user.selectOptions(field("Carry", "Distance unit"), "ft");
    await typeInto(user, "Carry", "Distance (ft)", "40");
    await user.click(logButton("Carry"));
    await within(card("Carry")).findByRole("button", { name: /24 kg · 40 ft/ });
    // The projected distanceM itself is pinned in outbox/project.test.ts (18.1 AC40).
    const rendered = within(card("Carry")).getByRole("button", { name: /24 kg · 40 ft/ });
    expect(rendered).toHaveTextContent("Not saved yet");
  });
});
