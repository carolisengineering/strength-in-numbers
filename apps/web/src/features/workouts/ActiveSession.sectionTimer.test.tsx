import { screen, waitFor, within } from "@testing-library/react";
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

import type { SectionTimer } from "@sin/core";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
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
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const TWO_ROUNDS = [
  { round: 1, seconds: 221 },
  { round: 2, seconds: 218 },
];

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
const sectionWrites = (fake: Setup["fake"]) =>
  fake.requests.filter((r) => (r.method === "PATCH" || r.method === "POST") && /\/v1\/(workout-sections\/|workouts\/[^/]+\/sections$)/.test(r.path));
const timed = (extra: Partial<WorkoutDetailOptions> = {}): WorkoutDetailOptions => ({
  sections: [{ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS }],
  exercises: [ex("Thruster", 0), ex("Pull-up", 0)],
  ...extra,
});
const untimedRecorded = (): WorkoutDetailOptions => ({
  sections: [{ name: "Main", timer: SET5 }],
  exercises: [ex("Thruster", 0), ex("Pull-up", 0)],
});

async function openEdit(user: Setup["user"], name = "Main") {
  await user.click(screen.getByRole("button", { name: `Edit section ${name}` }));
  return sheet("Edit section");
}
async function chooseAmrap(user: Setup["user"], dialog: ReturnType<typeof sheet>, digits = "1200") {
  await user.selectOptions(dialog.getByLabelText("Timer"), "amrap");
  await user.type(dialog.getByLabelText("Time limit"), digits);
}

describe("10.7 AC15 — Timer group on the workout sheets", () => {
  it("New section shows Timer under Note, and no field autofocuses", async () => {
    const { user } = await setup({ exercises: [ex("Row Erg")] });
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = sheet("New section");
    const note = dialog.getByLabelText("Note");
    const timer = dialog.getByLabelText("Timer");
    expect(note.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timer).toHaveValue("none");
    expect(dialog.getByLabelText("Name")).not.toHaveFocus();
    expect(timer).not.toHaveFocus();
  });

  it("Add with AMRAP 12:00 sends exactly { name, timer }", async () => {
    const { user, fake } = await setup({ exercises: [ex("Row Erg")] });
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = sheet("New section");
    await user.type(dialog.getByLabelText("Name"), "Finisher");
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section added: Finisher"));
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ name: "Finisher", timer: { format: "amrap", capSeconds: 720 } }]);
  });

  it("an invalid timer field shows its error and sends nothing", async () => {
    const { user, fake } = await setup({ exercises: [ex("Row Erg")] });
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = sheet("New section");
    await user.type(dialog.getByLabelText("Name"), "Finisher");
    await user.selectOptions(dialog.getByLabelText("Timer"), "amrap");
    await user.click(dialog.getByRole("button", { name: "Add section" }));
    expect(await dialog.findByText("Enter the time limit.")).toBeInTheDocument();
    expect(sectionWrites(fake)).toEqual([]);
  });

  it("a name-only edit of a timed section sends { name } and says Section saved", async () => {
    const { user, fake } = await setup(timed());
    const dialog = await openEdit(user);
    await user.type(dialog.getByLabelText("Name"), " set");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section saved"));
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ name: "Main set" }]);
  });

  it("a timer change says Timer saved, with or without a name change", async () => {
    const { user, fake } = await setup(untimedRecorded());
    let dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    dialog = await openEdit(user);
    await user.type(dialog.getByLabelText("Name"), " B");
    await user.selectOptions(dialog.getByLabelText("Timer"), "none");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sectionWrites(fake)).toHaveLength(2));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ timer: { format: "amrap", capSeconds: 720 } }, { name: "Main B", timer: null }]);
  });

  it("Save with nothing changed sends no request", async () => {
    const { user, fake } = await setup(timed());
    const dialog = await openEdit(user);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull());
    expect(sectionWrites(fake)).toEqual([]);
  });

  it("two Save taps send one PATCH", async () => {
    const { user } = await setup(untimedRecorded());
    const gate = deferred<void>();
    let patches = 0;
    server.use(
      http.patch(`${API_BASE_URL}/v1/workout-sections/:id`, async () => {
        patches += 1;
        await gate.promise;
        return HttpResponse.error();
      }),
    );
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    const save = dialog.getByRole("button", { name: "Save" });
    await user.click(save);
    await user.click(save);
    gate.resolve();
    await dialog.findByText("You're offline — try again when you have signal");
    expect(patches).toBe(1);
  });
});

describe("10.7 AC16 — confirm before clearing (live)", () => {
  it("a different format opens the confirm and sends nothing yet", async () => {
    const { user, fake } = await setup(timed());
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("dialog", { name: "Change Main's timer?" });
    expect(within(confirm).getByText("This clears the times and result you logged for this section.")).toBeInTheDocument();
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(within(confirm).getByRole("button", { name: "Change and clear" })).toHaveAttribute("data-variant", "danger");
    expect(sectionWrites(fake)).toEqual([]);
  });

  it("Cancel closes it, returns focus to Save and sends nothing", async () => {
    const { user, fake } = await setup(timed());
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("dialog", { name: "Change Main's timer?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change Main's timer?" })).toBeNull());
    await waitFor(() => expect(sheet("Edit section").getByRole("button", { name: "Save" })).toHaveFocus());
    expect(sheet("Edit section").getByLabelText("Timer")).toHaveValue("amrap");
    expect(sectionWrites(fake)).toEqual([]);
  });

  it("Change and clear sends discardResult and the times are gone after the re-read", async () => {
    const { user, fake } = await setup(timed());
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("dialog", { name: "Change Main's timer?" });
    await user.click(within(confirm).getByRole("button", { name: "Change and clear" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ timer: { format: "amrap", capSeconds: 720 }, discardResult: true }]);
    expect(fake.state.active!.sections[0]).toMatchObject({ timer: { format: "amrap", capSeconds: 720 }, roundTimes: [] });
    expect(screen.queryByRole("dialog", { name: "Change Main's timer?" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull();
  });

  it("with nothing recorded there is no dialog and no discardResult", async () => {
    const { user, fake } = await setup(untimedRecorded());
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(screen.queryByRole("dialog", { name: "Change Main's timer?" })).toBeNull();
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ timer: { format: "amrap", capSeconds: 720 } }]);
  });

  it("6 rounds over rounds 1–2 is sent plainly (Review Focus 1)", async () => {
    const { user, fake } = await setup(timed());
    const dialog = await openEdit(user);
    await user.clear(dialog.getByLabelText("Rounds"));
    await user.type(dialog.getByLabelText("Rounds"), "6");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(screen.queryByRole("dialog", { name: "Change Main's timer?" })).toBeNull();
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ timer: { ...SET5, rounds: 6 } }]);
    expect(fake.state.active!.sections[0]!.roundTimes).toEqual(TWO_ROUNDS);
  });
});

describe("10.7 AC18 — a stale screen", () => {
  it("409 keeps the sheet and what was typed, re-reads, and the next Save asks first", async () => {
    const { user, fake } = await setup(untimedRecorded());
    const dialog = await openEdit(user);
    await user.type(dialog.getByLabelText("Name"), " set");
    await chooseAmrap(user, dialog);
    // Another device logs round times after this screen loaded.
    fake.state.active = { ...fake.state.active!, sections: fake.state.active!.sections.map((s) => ({ ...s, roundTimes: TWO_ROUNDS })) };
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("Times were logged for this section. Check them and try again.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Name")).toHaveValue("Main set");
    expect(dialog.getByLabelText("Timer")).toHaveValue("amrap");
    expect(dialog.getByLabelText("Time limit")).toHaveValue("12:00");
    expect(fake.state.active!.sections[0]).toMatchObject({ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS });
    const reads = fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;
    expect(reads).toBeGreaterThan(1);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("dialog", { name: "Change Main's timer?" })).toBeInTheDocument();
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});

describe("10.7 AC24 — online-only timer writes", () => {
  it("the update mutation is networkMode always, retry false", async () => {
    const { user, queryClient } = await setup(untimedRecorded());
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    const mutations = queryClient.getMutationCache().getAll();
    expect(mutations.length).toBeGreaterThan(0);
    for (const m of mutations) expect(m.options).toMatchObject({ networkMode: "always", retry: false });
  });

  it("no sin:workout:* storage key is touched", async () => {
    const { user } = await setup(untimedRecorded());
    const set = vi.spyOn(Storage.prototype, "setItem");
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    const keys = set.mock.calls.map((c) => String(c[0]));
    set.mockRestore();
    expect(keys.filter((k) => /^sin:workout:/.test(k))).toEqual([]);
  });

  it("Add exercise waits while the timer PATCH is in flight", async () => {
    const { user } = await setup(untimedRecorded());
    const gate = deferred<void>();
    server.use(
      http.patch(`${API_BASE_URL}/v1/workout-sections/:id`, async () => {
        await gate.promise;
        return HttpResponse.error();
      }),
    );
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Add exercise", hidden: true }).every((b) => b.hasAttribute("disabled"))).toBe(true));
    gate.resolve();
    expect(await dialog.findByText("You're offline — try again when you have signal")).toBeInTheDocument();
  });

  it("track gets section_timer_set { format } once per change, none for a removal, and nothing user-typed", async () => {
    const { user } = await setup({ sections: [{ name: "Zq-Unique-Name", timer: SET5 }], exercises: [ex("Thruster", 0)] });
    let dialog = await openEdit(user, "Zq-Unique-Name");
    await chooseAmrap(user, dialog, "1234");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    dialog = await openEdit(user, "Zq-Unique-Name");
    await user.selectOptions(dialog.getByLabelText("Timer"), "none");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(observability.track.mock.calls.filter(([e]) => e === "section_timer_set")).toHaveLength(2));
    expect(observability.track.mock.calls.filter(([e]) => e === "section_timer_set")).toEqual([
      ["section_timer_set", { format: "amrap" }],
      ["section_timer_set", { format: "none" }],
    ]);
    const seen = JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls]);
    expect(seen).not.toContain("Zq-Unique-Name");
    expect(seen).not.toMatch(/754|12:34|"300"|rounds/);
  });

  it("a name-only edit emits no section_timer_set", async () => {
    const { user } = await setup(timed());
    const dialog = await openEdit(user);
    await user.type(dialog.getByLabelText("Name"), " set");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section saved"));
    expect(observability.track.mock.calls.filter(([e]) => e === "section_timer_set")).toEqual([]);
  });
});

describe("10.7 AC19 — the timed heading on the live screen", () => {
  it("shows the plan with its score and the times line; Other exercises shows neither", async () => {
    await setup({ sections: [{ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS }], exercises: [ex("Thruster", 0), ex("Row Erg")] });
    const main = screen.getByRole("region", { name: "Main" });
    expect(within(main).getByText("Set Timer 5 × 5:00 · total 7:19")).toBeInTheDocument();
    expect(within(main).getByText("Rounds 3:41 · 3:38")).toBeInTheDocument();
    // Phase C wires Log result on the live screen (Phase B showed none).
    expect(within(main).getByRole("button", { name: "Log result for Main" })).toBeInTheDocument();
    const other = screen.getByRole("region", { name: "Other exercises" });
    expect(within(other).queryByText(/Set Timer|^Rounds /)).toBeNull();
  });

  it("Change and clear: the times line is gone after the re-read", async () => {
    const { user } = await setup(timed());
    const dialog = await openEdit(user);
    await chooseAmrap(user, dialog);
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Change Main's timer?" })).getByRole("button", { name: "Change and clear" }));
    const main = screen.getByRole("region", { name: "Main" });
    expect(await within(main).findByText("AMRAP 12:00")).toBeInTheDocument();
    expect(within(main).queryByText(/^Rounds /)).toBeNull();
  });
});

describe("10.7 AC23 — the cap line on a workout", () => {
  it("a timed section of 9 rows with the first 8 grouped shows the line; ten loose rows don't", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ex(`E${i + 1}`, 0, { supersetGroup: i < 8 ? 1 : null }));
    await setup({ sections: [{ name: "Main", timer: SET5 }, { name: "Loose", timer: SET5 }], exercises: [...nine, ...Array.from({ length: 10 }, (_, i) => ex(`L${i + 1}`, 1))] });
    expect(within(screen.getByRole("region", { name: "Main" })).getByText("Only the first 8 exercises are grouped.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Loose" })).queryByText("Only the first 8 exercises are grouped.")).toBeNull();
  });
});

describe("10.7 AC25 — timer field errors in the sheet", () => {
  it("a 422 on timer.rounds shows the Rounds text under Rounds", async () => {
    const { user, fake } = await setup(untimedRecorded());
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-sections\// }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "timer.rounds", message: "SERVER-SECRET" }] }),
    );
    const dialog = await openEdit(user);
    await user.clear(dialog.getByLabelText("Rounds"));
    await user.type(dialog.getByLabelText("Rounds"), "7");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("Rounds go from 1 to 100.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Rounds")).toHaveAccessibleDescription(/Rounds go from 1 to 100\./);
    expect(screen.queryByText(/SERVER-SECRET/)).toBeNull();
  });
});
