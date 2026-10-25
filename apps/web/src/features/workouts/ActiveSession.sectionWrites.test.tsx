import { act, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { card, logButton, makeCurrent, optionsButton } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, ...extra });

async function setup(opts: WorkoutDetailOptions) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts), catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const announcement = () => screen.getByTestId("session-announcement");
const sectionPatches = (fake: Setup["fake"]) =>
  fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-exercises/")).map((r) => r.body);
const regionNames = () => screen.queryAllByRole("region").map((r) => r.querySelector("h2")?.textContent);

async function addSection(user: Setup["user"], name: string, notes = "") {
  await user.click(screen.getByRole("button", { name: "Add section" }));
  await user.type(sheet("New section").getByLabelText("Name"), name);
  if (notes) await user.type(sheet("New section").getByLabelText("Note"), notes);
  await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New section" })).toBeNull());
}
async function openPickerAndPick(user: Setup["user"]) {
  await user.click(screen.getAllByRole("button", { name: "Add exercise" }).at(-1)!);
  const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
  const all = within(dialog).getByRole("region", { name: "All exercises" });
  await user.click(within(all).getByRole("button", { name: /Bench Press/ }));
}
const sectionSelect = (name: string | RegExp) => within(card(name)).getByLabelText("Section");

describe("10.6 AC1 — Edit on headings", () => {
  it("a split section shows one Edit; Other exercises has none; Edit opens Edit section", async () => {
    const { user } = await setup({ sections: [{ name: "Warm-up", notes: "Easy" }], exercises: [ex("a", 0), ex("b"), ex("c", 0)] });
    expect(screen.getAllByRole("button", { name: "Edit section Warm-up" })).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Other exercises" })).queryByRole("button", { name: /^Edit section/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    expect(sheet("Edit section").getByLabelText("Name")).toHaveValue("Warm-up");
  });

  it("a workout with no sections has no Edit button", async () => {
    await setup({ exercises: [ex("a")] });
    expect(screen.queryByRole("button", { name: /^Edit section/ })).toBeNull();
  });
});

describe("10.6 AC2 — empty section", () => {
  it("an empty section shows its heading, note and No exercises yet.", async () => {
    await setup({ sections: [{ name: "Warm-up" }, { name: "Cooldown", notes: "Stretch", addedInWorkout: true }], exercises: [ex("a", 0)] });
    const cooldown = screen.getByRole("region", { name: "Cooldown" });
    expect(within(cooldown).getByText("Stretch")).toBeInTheDocument();
    expect(within(cooldown).getByText("No exercises yet.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Warm-up" })).queryByText("No exercises yet.")).toBeNull();
  });
});

describe("10.6 AC3 — Add section", () => {
  it("sits beside Add exercise, and alone in an empty workout; never in the bar; one primary Button", async () => {
    await setup({ exercises: [ex("a")] });
    const addSectionButton = screen.getByRole("button", { name: "Add section" });
    expect(addSectionButton.parentElement).toBe(screen.getAllByRole("button", { name: "Add exercise" }).find((b) => !b.closest("[data-testid='session-bar']"))!.parentElement);
    expect(within(screen.getByTestId("session-bar")).queryByRole("button", { name: "Add section" })).toBeNull();
    const primaries = screen.getAllByRole("button").filter((b) => /_primary_/.test(b.className) && !b.closest("dialog"));
    expect(primaries).toHaveLength(1);
  });

  it("an empty workout shows Add section alone in the row", async () => {
    await setup({ exercises: [] });
    const addSectionButton = screen.getByRole("button", { name: "Add section" });
    expect(within(addSectionButton.parentElement!).getAllByRole("button")).toEqual([addSectionButton]);
  });

  it("with 8 sections: disabled, with the reason linked", async () => {
    await setup({ sections: Array.from({ length: 8 }, (_, i) => ({ name: `S${i}` })), exercises: [ex("a", 0)] });
    const button = screen.getByRole("button", { name: "Add section" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("A workout can have up to 8 sections.");
  });
});

describe("10.6 AC4 / AC6 — the line and C4", () => {
  it("adding Cooldown shows the line, the status text, and the next Add exercise lands under it", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Warm-up" }], exercises: [ex("Row Erg", 0)] });
    expect(screen.queryByText(/New exercises go into/)).toBeNull();
    await addSection(user, "Cooldown", "Stretch");
    expect(fake.requests.find((r) => r.method === "POST" && r.path.endsWith("/sections"))!.body).toStrictEqual({ name: "Cooldown", notes: "Stretch" });
    expect(await screen.findByText("Cooldown", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Cooldown", { selector: "strong" }).parentElement).toHaveTextContent("New exercises go into Cooldown.");
    expect(announcement()).toHaveTextContent("Section added: Cooldown");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add section" })).toHaveFocus());
    await openPickerAndPick(user);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Cooldown" })).getByRole("article", { name: "Bench Press" })).toBeInTheDocument());
  });

  it("removing the added last section when the previous one was copied removes the line, and the next add is loose (Review Focus 2)", async () => {
    const { user } = await setup({ sections: [{ name: "Warm-up" }, { name: "Cooldown", addedInWorkout: true }], exercises: [ex("Row Erg", 0)] });
    expect(screen.getByText("Cooldown", { selector: "strong" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit section Cooldown" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Cooldown?").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Cooldown" })).toBeNull());
    expect(screen.queryByText(/New exercises go into/)).toBeNull();
    expect(announcement()).toHaveTextContent("Section removed");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add section" })).toHaveFocus());
    await openPickerAndPick(user);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Other exercises" })).getByRole("article", { name: "Bench Press" })).toBeInTheDocument());
  });
});

describe("10.6 AC7 / AC8 — edit and remove end to end", () => {
  it("Save renames from the refetch and says Section saved", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Warm-up", notes: "Easy" }], exercises: [ex("Row Erg", 0)] });
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    await user.clear(sheet("Edit section").getByLabelText("Name"));
    await user.type(sheet("Edit section").getByLabelText("Name"), "Prep");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("region", { name: "Prep" })).toBeInTheDocument();
    expect(fake.requests.find((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-sections/"))!.body).toStrictEqual({ name: "Prep" });
    expect(announcement()).toHaveTextContent("Section saved");
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit section Prep" })).toHaveFocus());
  });

  it("Remove keeps the exercises, loose", async () => {
    const { user } = await setup({ sections: [{ name: "Warm-up" }, { name: "Main" }], exercises: [ex("Row Erg", 0), ex("Squat", 1)] });
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Warm-up?").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(regionNames()).not.toContain("Warm-up"));
    expect(screen.getByRole("article", { name: "Row Erg" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Main" })).queryByRole("article", { name: "Row Erg" })).toBeNull(); // loose first: no heading
    expect(screen.queryByRole("region", { name: "Other exercises" })).toBeNull();
  });
});

describe("10.6 AC9 / AC10 — move", () => {
  const MOVE: WorkoutDetailOptions = {
    sections: [{ name: "Warm-up" }],
    exercises: [ex("Row Erg", null, { sets: [makeSet({ setNumber: 1 })] }), ex("Squat", 0)],
  };

  it("Options → Section → Warm-up: one { sectionId } PATCH; the card moves, its heading is focused, the status says so, it stays current", async () => {
    const { user, fake } = await setup(MOVE);
    await makeCurrent(user, "Row Erg");
    await user.click(optionsButton("Row Erg"));
    expect(sectionSelect("Row Erg")).toHaveDisplayValue("No section");
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Warm-up" })).getByRole("article", { name: "Row Erg" })).toBeInTheDocument());
    const warmup = fake.state.active!.sections[0]!.id;
    expect(sectionPatches(fake)).toStrictEqual([{ sectionId: warmup }]);
    await waitFor(() => expect(within(card("Row Erg")).getByRole("heading", { level: 2 })).toHaveFocus());
    expect(announcement()).toHaveTextContent("Moved Row Erg to Warm-up");
    expect(optionsButton("Row Erg")).toBeInTheDocument(); // still the current card
  });

  it("#157 — a move whose re-read fails: a later unrelated change does not focus that card", async () => {
    const { user, fake } = await setup(MOVE);
    await makeCurrent(user, "Row Erg");
    fake.failNext({ method: "GET", path: /^\/v1\/workouts\/active$/ }, () => HttpResponse.error() as Response);
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved Row Erg to Warm-up"));
    expect(within(screen.getByRole("region", { name: "Warm-up" })).queryByRole("article", { name: "Row Erg" })).toBeNull();
    const focus = vi.spyOn(within(card("Row Erg")).getByRole("heading", { level: 2 }), "focus");
    await user.click(logButton("Row Erg")); // an unrelated list change: a logged set lands in the cache
    await waitFor(() => expect(within(card("Row Erg")).getAllByRole("listitem").length).toBeGreaterThan(1));
    expect(focus).not.toHaveBeenCalled();
  });

  it("re-choosing the current value sends nothing; No section moves it out", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] });
    await makeCurrent(user, "Squat");
    await user.click(optionsButton("Squat"));
    await user.selectOptions(sectionSelect("Squat"), "Warm-up");
    expect(sectionPatches(fake)).toEqual([]);
    await user.selectOptions(sectionSelect("Squat"), "No section");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved Squat out of its section"));
    expect(sectionPatches(fake)).toStrictEqual([{ sectionId: null }]);
  });
});

describe("10.6 AC11 — supersets", () => {
  it("a linked card shows the hint; after the move neither it nor its lone former partner shows a bracket", async () => {
    const { user } = await setup({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("A"), ex("B", null, { supersetGroup: 1 }), ex("C", null, { supersetGroup: 1 })] });
    await makeCurrent(user, /^B/);
    await user.click(optionsButton(/^B/));
    expect(sectionSelect(/^B/)).toHaveAccessibleDescription("Changing the section takes it out of its superset.");
    await user.selectOptions(sectionSelect(/^B/), "Warm-up");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved B to Warm-up"));
    expect(document.querySelectorAll("[data-bracket]:not([data-bracket='none'])")).toHaveLength(0);
  });
});

describe("10.6 AC12 — offline and busy", () => {
  it("with a set queued offline, a move fails at once with the offline text and the select keeps its value; the set syncs later (Review Focus 1)", async () => {
    const { user, fake } = await setup({
      sections: [{ name: "Warm-up" }],
      exercises: [ex("Squat", 0), ex("Row Erg", null, { sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] })],
    });
    await makeCurrent(user, "Row Erg");
    online = false;
    fake.setOffline(true);
    act(() => void window.dispatchEvent(new Event("offline")));
    const reps = within(card("Row Erg")).getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "5");
    await user.click(logButton("Row Erg"));
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    expect(await screen.findByText("You're offline — try again when you have signal")).toBeInTheDocument();
    expect(sectionSelect("Row Erg")).toHaveDisplayValue("No section");
    online = true;
    fake.setOffline(false);
    act(() => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(fake.state.active!.exercises.find((e) => e.exerciseNameSnapshot === "Row Erg")!.sets).toHaveLength(2));
    expect(sectionPatches(fake)).toEqual([]);
  });

  it("no sin:workout:* storage key is touched by a section write", async () => {
    const { user } = await setup({ sections: [{ name: "Warm-up" }], exercises: [ex("Row Erg", 0)] });
    const set = vi.spyOn(Storage.prototype, "setItem");
    const get = vi.spyOn(Storage.prototype, "getItem");
    await addSection(user, "Cooldown");
    await waitFor(() => expect(announcement()).toHaveTextContent("Section added: Cooldown"));
    const keys = [...set.mock.calls, ...get.mock.calls].map((c) => String(c[0]));
    set.mockRestore();
    get.mockRestore();
    expect(keys.filter((k) => /^sin:workout:/.test(k))).toEqual([]);
  });

  it("Add section and Finish wait while a section write is in flight", async () => {
    const { user } = await setup({ exercises: [ex("Row Erg", null, { sets: [makeSet({ setNumber: 1 })] })] });
    const gate = deferred<void>();
    server.use(
      http.post(`${API_BASE_URL}/v1/workouts/:id/sections`, async () => {
        await gate.promise;
        return HttpResponse.error();
      }),
    );
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.type(sheet("New section").getByLabelText("Name"), "Cooldown");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Finish workout", hidden: true }).every((b) => b.hasAttribute("disabled"))).toBe(true));
    expect(screen.getAllByRole("button", { name: "Add section", hidden: true }).every((b) => b.hasAttribute("disabled"))).toBe(true);
    gate.resolve();
    expect(await sheet("New section").findByText("You're offline — try again when you have signal")).toBeInTheDocument();
  });
});

describe("10.6 AC6 / AC10 — focus after the final review", () => {
  it("adding the 8th section: Add section is disabled, so focus goes to the new section's Edit", async () => {
    const { user } = await setup({ sections: Array.from({ length: 7 }, (_, i) => ({ name: `S${i}` })), exercises: [ex("a", 0)] });
    await addSection(user, "Eighth");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add section" })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit section Eighth" })).toHaveFocus());
  });

  it("a failed move puts focus back on the Section select (the browser blurs it while disabled)", async () => {
    const { user } = await setup({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] });
    const gate = deferred<void>();
    server.use(
      http.patch(`${API_BASE_URL}/v1/workout-exercises/:id`, async () => {
        await gate.promise;
        return HttpResponse.error();
      }),
    );
    await makeCurrent(user, "Row Erg");
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(sectionSelect("Row Erg")).toBeDisabled());
    // A browser moves focus off a focused control that becomes disabled; jsdom ignores blur() on one, so move it.
    act(() => optionsButton("Row Erg").focus());
    expect(sectionSelect("Row Erg")).not.toHaveFocus();
    gate.resolve();
    expect(await screen.findByText("You're offline — try again when you have signal")).toBeInTheDocument();
    await waitFor(() => expect(sectionSelect("Row Erg")).toHaveFocus());
  });
});

