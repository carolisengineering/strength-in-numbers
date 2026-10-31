import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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

import { HevyFolderPageSchema, HevyRoutinePageSchema } from "@sin/core";

import { API_BASE_URL } from "../../../test/accountHarness";
import { hevyFixtures } from "../../../test/hevyFixtures";
import { setInstantPacing, userInfoOk, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyApi, fakeImportApi, generateHevyWorkouts, type HevyFakeFixture } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { pinTimeZone } from "../../../test/timeZone";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { HEVY_GET_RETRY_WAITS_MS } from "../client/pacer";
import { HEVY_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { HEVY_COPY } from "../messages";
import { HEVY_PATH } from "../paths";
import { HEVY_IMPORT_PATH } from "./paths";

const EVERY_TRY = 1 + HEVY_GET_RETRY_WAITS_MS.length;
const STATUS = { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false };
const templates = (hevyFixtures.templatesPage() as { exercise_templates: unknown[] }).exercise_templates;
const folders = HevyFolderPageSchema.parse(hevyFixtures.foldersPage()).routine_folders;
const routines = HevyRoutinePageSchema.parse(hevyFixtures.routinesPage()).routines;

function setup(opts: { key?: boolean; status?: false | typeof STATUS; hevy?: HevyFakeFixture; unit?: "kg" | "lb"; profileZone?: string } = {}) {
  prepareApp({ auth, fake: createWorkoutFake(), unitPreference: opts.unit ?? "kg" });
  const hevy = fakeHevyApi({ templates, folders, routines, workouts: generateHevyWorkouts(12), ...opts.hevy });
  const imports = fakeImportApi({ recordsStale: opts.status ? opts.status.recordsStale : false });
  server.use(
    ...hevy.handlers,
    userInfoOk(),
    http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json({ pairs: [], sectionRules: [] })),
    ...(opts.status === false ? imports.handlers.filter((_, i) => i < 2) : imports.handlers),
  );
  if (opts.profileZone) {
    server.use(
      http.get(`${API_BASE_URL}/v1/me`, () =>
        HttpResponse.json({ id: USER_ID, email: "lifter@example.com", displayName: "Sam", unitPreference: opts.unit ?? "kg", timezone: opts.profileZone, createdAt: "2026-01-01T00:00:00.000Z" }),
      ),
    );
  }
  if (opts.key !== false) hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return { hevy, imports };
}

beforeEach(() => setInstantPacing());
afterEach(() => {
  // Unmount first: removing the key re-renders a mounted screen after the env is gone.
  cleanup();
  hevyKeyStore.remove(USER_ID);
  cleanupApp();
});

const startReading = async (user: ReturnType<typeof renderApp>["user"]) => {
  await user.click(await screen.findByRole("button", { name: "Start" }));
};

describe("20.1 AC1 — entry", () => {
  it("with status 200 and a key, the Hevy screen links to the import", async () => {
    setup({ status: STATUS });
    renderApp(HEVY_PATH);
    const card = await screen.findByRole("region", { name: "Import from Hevy" });
    expect(within(card).getByRole("link", { name: "Import from Hevy" })).toHaveAttribute("href", HEVY_IMPORT_PATH);
  });

  it("without a key, the card says to add one and the route shows the key card", async () => {
    setup({ status: STATUS, key: false });
    const { router } = renderApp(HEVY_PATH);
    const card = await screen.findByRole("region", { name: "Import from Hevy" });
    expect(within(card).getByText("Add your Hevy key first")).toBeInTheDocument();
    expect(within(card).queryByRole("link")).toBeNull();
    await act(() => router.navigate(HEVY_IMPORT_PATH));
    expect(await screen.findByText("Add your Hevy key first")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hevy key" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("with the default status (404) the path is not found", async () => {
    setup({ status: false });
    renderApp(HEVY_IMPORT_PATH);
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });
});

describe("20.1 AC2 — preflight", () => {
  pinTimeZone("Europe/London");

  it("names the device zone and points at Profile when the Profile zone differs", async () => {
    setup({ status: STATUS, profileZone: "America/Chicago", unit: "lb" });
    renderApp(HEVY_IMPORT_PATH);
    expect(await screen.findByText(/Dates use this device's time zone: Europe\/London\./)).toBeInTheDocument();
    const zoneLine = (await screen.findByText(/Your Profile time zone is America\/Chicago\./)).closest("li")!;
    expect(within(zoneLine).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByText("Weights are stored in lb (your Profile setting).")).toBeInTheDocument();
    expect(screen.getByText("It is safe to run again: anything already imported is skipped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("says nothing about Profile when the zones match", async () => {
    setup({ status: STATUS });
    renderApp(HEVY_IMPORT_PATH);
    expect(await screen.findByText(/Dates use this device's time zone: Europe\/London\./)).toBeInTheDocument();
    expect(await screen.findByText("Weights are stored in kg (your Profile setting).")).toBeInTheDocument();
    expect(screen.queryByText(/Your Profile time zone/)).toBeNull();
  });

  it("with stale records, the banner finishes the last step once, with no body", async () => {
    const { imports } = setup({ status: { ...STATUS, recordsStale: true } });
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull();
    const finishes = imports.log.filter((r) => r.path === "/v1/hevy/import/finish");
    expect(finishes).toEqual([{ path: "/v1/hevy/import/finish", method: "POST", contentType: null, body: undefined }]);
  });
});

describe("Minor 249 — Start is the one primary button", () => {
  it("on preflight, the only primary button in the step is Start", async () => {
    setup({ status: STATUS });
    renderApp(HEVY_IMPORT_PATH);
    const step = await screen.findByRole("region", { name: "Before you start" });
    const primary = within(step).getAllByRole("button").filter((b) => b.dataset.variant === "primary");
    expect(primary.map((b) => b.textContent)).toEqual(["Start"]);
  });
});

describe("20.1 AC3 / AC5 — reading UI", () => {
  it("shows the stage and page in a polite status, and Cancel returns to preflight", async () => {
    const { hevy } = setup({ status: STATUS, hevy: { workouts: generateHevyWorkouts(120) } });
    hevy.holdPage("/v1/workouts", 5);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    const status = await screen.findByText("Reading Hevy… workouts, page 4 of 12");
    expect(status).toHaveAttribute("role", "status");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("the templates stage takes its page from the shared template read", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `T${i}`, title: `Template ${i}`, type: "weight_reps", is_custom: false }));
    const { hevy } = setup({ status: STATUS, hevy: { templates: many } });
    hevy.holdPage("/v1/exercise_templates", 2);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    expect(await screen.findByText("Reading Hevy… exercises, page 1 of 3")).toBeInTheDocument();
  });

  it("Minor 245 — Cancel stops a refetch of a stale template cache", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `T${i}`, title: `Template ${i}`, type: "weight_reps", is_custom: false }));
    const { hevy } = setup({ status: STATUS, hevy: { templates: many } });
    hevy.holdPage("/v1/exercise_templates", 2);
    const { user, queryClient } = renderApp(HEVY_IMPORT_PATH);
    // A list read 11 minutes ago: past its 10-minute staleTime, so this import's read refetches it.
    queryClient.setQueryData(HEVY_KEYS.templates, many.slice(0, 1), { updatedAt: Date.now() - 11 * 60_000 });
    await startReading(user);
    await screen.findByText("Reading Hevy… exercises, page 1 of 3");
    expect(queryClient.getQueryState(HEVY_KEYS.templates)?.fetchStatus).toBe("fetching");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(queryClient.getQueryState(HEVY_KEYS.templates)?.fetchStatus).toBe("idle"));
  });

  it("a stage that fails after the retries offers Try again, which restarts only that stage", async () => {
    const { hevy } = setup({ status: STATUS });
    hevy.failNext("/v1/routines", 500, EVERY_TRY);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    expect(await screen.findByText("Couldn't finish reading Hevy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    const before = hevy.log.length;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(hevy.log.slice(before).some((r) => r.path === "/v1/workouts")).toBe(true));
    const again = hevy.log.slice(before);
    expect(again[0]).toEqual({ path: "/v1/routines", page: 1, pageSize: 10 });
    expect(again.some((r) => r.path === "/v1/workouts/count")).toBe(false);
  });

  it("a refused key shows the key card", async () => {
    const { hevy } = setup({ status: STATUS });
    hevy.failNext("/v1/workouts/count", 401);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    expect(await screen.findByText(HEVY_COPY.bad_key)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hevy key" })).toBeInTheDocument();
  });

  it("a reply Hevy sent that isn't understood stops with no Try again", async () => {
    const { hevy } = setup({ status: STATUS });
    hevy.failNext("/v1/routine_folders", "garbage");
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    expect(await screen.findByText(HEVY_COPY.unexpected_reply)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("a network failure says so and offers Try again", async () => {
    const { hevy } = setup({ status: STATUS });
    hevy.failNext("/v1/workouts", "network", EVERY_TRY);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    expect(await screen.findByText(HEVY_COPY.network)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("states the reconciliation difference", async () => {
    setup({ status: STATUS, hevy: { workouts: generateHevyWorkouts(12), count: 13 } });
    const { user } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    expect(
      await screen.findByText(
        "Hevy reported 13 workouts but sent 12. Workouts added or removed while reading can cause this; run the import again later to catch up.",
      ),
    ).toBeInTheDocument();
  });
});

describe("20.1 AC15 — dropped on unmount", () => {
  it("leaving mid-read aborts it, and coming back starts at preflight", async () => {
    const { hevy } = setup({ status: STATUS, hevy: { workouts: generateHevyWorkouts(40) } });
    hevy.holdPage("/v1/workouts", 2);
    const { user, router } = renderApp(HEVY_IMPORT_PATH);
    await startReading(user);
    await screen.findByText("Reading Hevy… workouts, page 1 of 4");
    await act(() => router.navigate("/app/profile"));
    const sent = hevy.log.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(hevy.log.length).toBe(sent);
    await act(() => router.navigate(HEVY_IMPORT_PATH));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});

describe("20.1 AC29 — step focus", () => {
  it("moves focus to the new step's heading and marks the current step", async () => {
    const { hevy } = setup({ status: STATUS });
    hevy.holdPage("/v1/workouts", 1);
    const { user } = renderApp(HEVY_IMPORT_PATH);
    const nav = await screen.findByRole("navigation", { name: "Import steps" });
    expect(within(nav).getByText("1 Read")).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByText("2 Routines")).not.toHaveAttribute("aria-current");
    await startReading(user);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Reading Hevy" })).toHaveFocus());
  });
});
