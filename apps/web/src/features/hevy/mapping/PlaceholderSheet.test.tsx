import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { API_BASE_URL, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, templatesHandler, setInstantPacing, userInfoOk } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { HEVY_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { CHOOSE_MARKERS, NO_KEY_FOR_FILE, NO_MARKERS, mappingRateLimited, replaceExercisePairing } from "../messages";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const tpl = (id: string, title: string, type = "reps_only") => ({ id, title, type, is_custom: true, primary_muscle_group: "other", secondary_muscle_groups: [], equipment: "none" });
const TEMPLATES = [tpl("W", "Warmup"), tpl("L", "warmup"), tpl("X", "workout"), tpl("B", "Bench Press", "weight_reps"), tpl("U", "Unsupported thing", "a_future_type")];

let patches: unknown[] = [];
let templateReads = 0;
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  patches = [];
  templateReads = 0;
  server.use(userInfoOk(), templatesHandler(TEMPLATES));
  server.events.on("request:start", async ({ request }) => {
    if (request.method === "PATCH") patches.push(await request.clone().json());
    if (new URL(request.url).pathname === "/v1/exercise_templates") templateReads += 1;
  });
});
afterEach(() => {
  server.events.removeAllListeners();
  clearHevyKey();
  unstubAccountEnv();
});

async function openMarkers() {
  renderHevyScreen();
  await userEvent.click(await screen.findByRole("button", { name: CHOOSE_MARKERS }));
  return screen.findByRole("dialog", { name: "Section markers" });
}

describe("20.0 AC30 — section markers", () => {
  it("pre-selects the templates titled exactly Warmup and workout; a lowercase warmup is not", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    const dialog = await openMarkers();
    const warm = await within(dialog).findByRole("group", { name: "Warmup" });
    expect(within(warm).getByRole("radio", { name: "Warmup" })).toBeChecked();
    expect(within(warm).getByRole("radio", { name: "warmup" })).not.toBeChecked();
    expect(within(within(dialog).getByRole("group", { name: "workout" })).getByRole("radio", { name: "workout" })).toBeChecked();
  });

  it("search narrows the lists", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    const dialog = await openMarkers();
    await within(dialog).findByRole("group", { name: "Warmup" });
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search Hevy exercises" }), "bench");
    const warm = within(dialog).getByRole("group", { name: "Warmup" });
    expect(within(warm).queryByRole("radio", { name: "Warmup" })).toBeNull();
    expect(within(warm).getByRole("radio", { name: "Bench Press" })).toBeInTheDocument();
  });

  it("Save sends one PATCH with both markers", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    server.use(http.patch(MAPPING_URL, () => HttpResponse.json({ pairs: [], sectionRules: [] })));
    const dialog = await openMarkers();
    await within(dialog).findByRole("group", { name: "Warmup" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save markers" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      upsert: [
        { hevyTemplateId: "W", hevyTitle: "Warmup", hevyType: "reps_only", role: "warmup_placeholder", exerciseId: null, measureRule: null, exportAs: false },
        { hevyTemplateId: "X", hevyTitle: "workout", hevyType: "reps_only", role: "workout_placeholder", exerciseId: null, measureRule: null, exportAs: false },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("choosing only one marker sends only that one", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    server.use(http.patch(MAPPING_URL, () => HttpResponse.json({ pairs: [], sectionRules: [] })));
    const dialog = await openMarkers();
    const workout = await within(dialog).findByRole("group", { name: "workout" });
    await userEvent.click(within(workout).getByRole("radio", { name: "None" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save markers" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0] as { upsert: { role: string }[] }).upsert.map((p) => p.role)).toEqual(["warmup_placeholder"]);
  });

  it("is optional: with none set the card says so, with no error", async () => {
    renderHevyScreen();
    expect(await screen.findByText(NO_MARKERS)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with no key it says so and asks Hevy nothing", async () => {
    const dialog = await openMarkers();
    expect(await within(dialog).findByText(NO_KEY_FOR_FILE)).toBeInTheDocument();
    expect(templateReads).toBe(0);
  });
});

describe("20.0 AC30 — a re-read of Hevy's list keeps the lifter's choice (code review)", () => {
  it("a chosen marker survives a templates refetch", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    const { queryClient } = renderHevyScreen();
    await userEvent.click(await screen.findByRole("button", { name: CHOOSE_MARKERS }));
    const dialog = await screen.findByRole("dialog", { name: "Section markers" });
    const warm = await within(dialog).findByRole("group", { name: "Warmup" });
    await userEvent.click(within(warm).getByRole("radio", { name: "warmup" }));
    const before = templateReads;
    // The re-read finds one more template, so the list is a new object (an equal list keeps its reference).
    server.use(templatesHandler([...TEMPLATES, tpl("N", "Stretch")]));
    await queryClient.refetchQueries({ queryKey: HEVY_KEYS.templates });
    await waitFor(() => expect(templateReads).toBeGreaterThan(before));
    await within(warm).findByRole("radio", { name: "Stretch" });
    expect(within(warm).getByRole("radio", { name: "warmup" })).toBeChecked();
  });
});

describe("Minor 182 — impossible marker choices are refused before the server", () => {
  it("a template chosen for one marker can't be the other, and a type-less template can't be either", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    const dialog = await openMarkers();
    const warm = await within(dialog).findByRole("group", { name: "Warmup" });
    const work = within(dialog).getByRole("group", { name: "workout" });
    // Warmup starts on "Warmup", so the workout group can't take it.
    expect(within(work).getByRole("radio", { name: "Warmup" })).toBeDisabled();
    expect(within(warm).getByRole("radio", { name: "workout" })).toBeDisabled();
    expect(within(warm).getByRole("radio", { name: "Unsupported thing" })).toBeDisabled();
    expect(within(work).getByRole("radio", { name: "Unsupported thing" })).toBeDisabled();
  });

  it("replacing an exercise pairing asks first, naming both; Cancel sends nothing (Review Focus 4)", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    const bench = makeExercise({ id: exerciseId(1), name: "Bench Press" });
    server.use(
      http.get(MAPPING_URL, () =>
        HttpResponse.json({
          pairs: [{ hevyTemplateId: "B", hevyTitle: "Bench Press", hevyType: "weight_reps", role: "exercise", exerciseId: bench.id, exerciseActive: true, measureRule: null, exportAs: true }],
          sectionRules: [],
        }),
      ),
    );
    renderHevyScreen(undefined, { catalog: [bench] });
    await userEvent.click(await screen.findByRole("button", { name: CHOOSE_MARKERS }));
    const dialog = await screen.findByRole("dialog", { name: "Section markers" });
    const work = await within(dialog).findByRole("group", { name: "workout" });
    await userEvent.click(within(work).getByRole("radio", { name: "Bench Press" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save markers" }));
    const confirm = await screen.findByRole("dialog", { name: /as a marker instead/i });
    expect(confirm).toHaveTextContent(replaceExercisePairing("Bench Press", "Bench Press"));
    expect(patches).toEqual([]);
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(patches).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save markers" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: /as a marker instead/i })).getByRole("button", { name: "Use as marker" }));
    await waitFor(() => expect(patches).toHaveLength(1));
  });
});

describe("Minor 181 — the markers sheet's 429 says how long", () => {
  it("a PATCH 429 with Retry-After 7 shows the 7-second sentence", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    server.use(
      http.patch(MAPPING_URL, () =>
        HttpResponse.json({ type: "x/rate-limited", title: "t", status: 429, detail: "d", instance: "i" }, { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "7" } }),
      ),
    );
    const dialog = await openMarkers();
    await within(dialog).findByRole("group", { name: "Warmup" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save markers" }));
    expect(await within(dialog).findByText(mappingRateLimited(7_000))).toBeInTheDocument();
  });
});

describe("Minor 194 — the markers search folds accents (minor 192's shared fold, NFD)", () => {
  it("a plain-letter search finds an accented title", async () => {
    server.use(templatesHandler([...TEMPLATES, tpl("D", "Développé Couché", "weight_reps")]));
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    const dialog = await openMarkers();
    await within(dialog).findByRole("group", { name: "Warmup" });
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search Hevy exercises" }), "developpe");
    const warm = within(dialog).getByRole("group", { name: "Warmup" });
    expect(within(warm).getByRole("radio", { name: "Développé Couché" })).toBeInTheDocument();
    expect(within(warm).queryByRole("radio", { name: "Bench Press" })).toBeNull();
  });
});
