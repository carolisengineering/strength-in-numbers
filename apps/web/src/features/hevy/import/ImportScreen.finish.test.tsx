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
const caches = vi.hoisted(() => ({ imported: vi.fn() }));
vi.mock("../../records/cache", async (original) => {
  const actual = await original<typeof import("../../records/cache")>();
  return {
    ...actual,
    applyImportedCaches: (...args: Parameters<typeof actual.applyImportedCaches>) => {
      caches.imported(...args);
      actual.applyImportedCaches(...args);
    },
  };
});

import { API_BASE_URL } from "../../../test/accountHarness";
import { setInstantPacing, userInfoOk, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeImportApi, generateHevyWorkouts } from "../../../test/hevyImportFakes";
import { finishRequests, importButton, realBatches, setupImportRun, toSummary } from "../../../test/hevyImportRun";
import { server } from "../../../test/msw/server";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
import { HEVY_PATH } from "../paths";
import { resetImportLaneForTests } from "./importLane";

function setup(options: Parameters<typeof fakeImportApi>[0] = {}) {
  prepareApp({ auth, fake: createWorkoutFake() });
  const imports = fakeImportApi(options);
  server.use(userInfoOk(), http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json({ pairs: [], sectionRules: [] })), ...imports.handlers);
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return imports;
}

beforeEach(() => {
  setInstantPacing();
  caches.imported.mockReset();
});
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  resetImportLaneForTests();
  cleanupApp();
});

const finishes = (imports: ReturnType<typeof fakeImportApi>) => imports.log.filter((r) => r.path === "/v1/hevy/import/finish");

describe("20.1 AC22 — the Hevy screen's stale-records banner", () => {
  it("shows while the records are stale; Finish the last step sends one finish with no body and refreshes the caches", async () => {
    const imports = setup({ recordsStale: true });
    const { user } = renderApp(HEVY_PATH);
    await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull();
    expect(finishes(imports)).toEqual([{ path: "/v1/hevy/import/finish", method: "POST", contentType: null, body: undefined }]);
    expect(caches.imported).toHaveBeenCalledTimes(1);
  });

  it("is absent when the records are not stale", async () => {
    setup({ recordsStale: false });
    renderApp(HEVY_PATH);
    expect(await screen.findByRole("heading", { name: "Import from Hevy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull();
  });

  describe("Minor 241 — the records banner", () => {
    const STATUS_URL = `${API_BASE_URL}/v1/hevy/status`;
    const statusBody = (recordsStale: boolean) => ({ enabled: true, pairCount: 0, linkCount: 0, recordsStale });
    /** The first status read says stale; the re-read after the finish waits for `answer` (its `recordsStale`). */
    function heldStatusReread() {
      let reads = 0;
      let answer: (stale: boolean) => void = () => {};
      const later = new Promise<boolean>((resolve) => (answer = resolve));
      server.use(
        http.get(STATUS_URL, async () => {
          reads += 1;
          if (reads === 1) return HttpResponse.json(statusBody(true));
          return HttpResponse.json(statusBody(await later));
        }),
      );
      return { answer, reads: () => reads };
    }

    it("its status line is there, empty, before the finish, and the same line says Records updated", async () => {
      setup({ recordsStale: true });
      const { user } = renderApp(HEVY_PATH);
      const button = await screen.findByRole("button", { name: "Finish the last step" });
      const before = screen.getAllByRole("status");
      await user.click(button);
      const updated = await screen.findByText("Records updated.");
      expect(before).toContain(updated);
    });

    it("while empty the line is visually hidden, so it adds no gap to the screen (final review)", async () => {
      setup({ recordsStale: true });
      const { user } = renderApp(HEVY_PATH);
      const button = await screen.findByRole("button", { name: "Finish the last step" });
      // Each status line's class before the finish; the banner's is the one that later says Records updated.
      const before = new Map(screen.getAllByRole("status").map((s) => [s, s.className]));
      await user.click(button);
      const updated = await screen.findByText("Records updated.");
      expect(before.get(updated)).toMatch(/_hidden_/);
      expect(updated.className).not.toMatch(/_hidden_/);
    });

    it("once the finish succeeds, no Finish button is offered while the status is re-read", async () => {
      const imports = setup({ recordsStale: true });
      const status = heldStatusReread();
      const { user } = renderApp(HEVY_PATH);
      await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
      expect(await screen.findByText("Records updated.")).toBeInTheDocument();
      await waitFor(() => expect(status.reads()).toBe(2));
      expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull();
      expect(finishes(imports)).toHaveLength(1);
      status.answer(false);
    });

    it("if the re-read still says stale (another run), the banner comes back with Finish enabled (Review Focus 4)", async () => {
      setup({ recordsStale: true });
      const status = heldStatusReread();
      const { user } = renderApp(HEVY_PATH);
      await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
      await screen.findByText("Records updated.");
      await waitFor(() => expect(status.reads()).toBe(2));
      status.answer(true);
      expect(await screen.findByRole("button", { name: "Finish the last step" })).toBeEnabled();
    });

    it("minor 274: the device clock going back an hour before the re-read still brings the card back", async () => {
      setup({ recordsStale: true });
      const status = heldStatusReread();
      const { user } = renderApp(HEVY_PATH);
      await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
      await screen.findByText("Records updated.");
      await waitFor(() => expect(status.reads()).toBe(2));
      vi.setSystemTime(Date.now() - 60 * 60_000);
      try {
        status.answer(true);
        expect(await screen.findByRole("button", { name: "Finish the last step" })).toBeEnabled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("a failed finish says so and stays; Try again succeeds and the banner goes", async () => {
    const imports = setup({ recordsStale: true });
    imports.failSequence([500]);
    const { user } = renderApp(HEVY_PATH);
    await user.click(await screen.findByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Your workouts are in, but updating your records didn't finish.")).toBeInTheDocument();
    expect(caches.imported).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(finishes(imports)).toHaveLength(2);
    expect(caches.imported).toHaveBeenCalledTimes(1);
  });

  it("a finish answering recomputed: false still reads Records updated (Review Focus 5)", async () => {
    const imports = setup({ recordsStale: true });
    // Another tab finished first: the server holds nothing stale, but this tab's status still says stale.
    server.use(http.post(`${API_BASE_URL}/v1/hevy/import/finish`, () => HttpResponse.json({ recomputed: false, rootCount: 0 })));
    const { user } = renderApp(HEVY_PATH);
    const button = await screen.findByRole("button", { name: "Finish the last step" });
    imports.state.recordsStale = false;
    await user.click(button);
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Finish the last step" })).toBeNull());
  });
});

const doneHeading = () => screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });

describe("20.1 AC22 — finish after the run", () => {
  it("after the last batch: one finish with no body, Updating your records… then Records updated.", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(30) });
    const release = imports.gateFinish();
    const { user } = await toSummary();
    await user.click(importButton());
    expect(await screen.findByText("Updating your records…")).toHaveAttribute("role", "status");
    release();
    await doneHeading();
    expect(await screen.findByText("Records updated.")).toHaveAttribute("role", "status");
    expect(finishRequests(imports)).toEqual([{ path: "/v1/hevy/import/finish", method: "POST", contentType: null, body: undefined }]);
  });

  it("a failed finish says so with Try again; the Hevy screen shows the banner until a finish succeeds", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const { user } = await toSummary();
    imports.failFinish([500]);
    await user.click(importButton());
    await doneHeading();
    expect(await screen.findByText("Your workouts are in, but updating your records didn't finish.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("link", { name: "Back to Hevy" })[0]!);
    const banner = await screen.findByRole("region", { name: "Your last import didn't finish updating your records." });
    await user.click(within(banner).getByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(finishRequests(imports)).toHaveLength(2);
  });

  it("Try again on the done screen finishes and says so", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const { user } = await toSummary();
    imports.failFinish([500]);
    await user.click(importButton());
    await doneHeading();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(finishRequests(imports)).toHaveLength(2);
  });

  it("a run that created nothing, with records not stale, sends no finish", async () => {
    const workouts = generateHevyWorkouts(3);
    const { imports } = setupImportRun(auth, { workouts, imports: { duplicateOf: new Map(workouts.map((w, i) => [w.id, `00000000-0000-4000-8000-00000000000${i}`])) } });
    const { user } = await toSummary();
    await user.click(importButton());
    await doneHeading();
    expect(realBatches(imports)).toHaveLength(1);
    expect(finishRequests(imports)).toEqual([]);
    expect(screen.queryByText("Records updated.")).toBeNull();
  });

  it("Finish up from Stopped sends the finish once", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(60) });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    await user.click(importButton());
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    release();
    const finishUp = await screen.findByRole("button", { name: "Finish up" });
    act(() => {
      finishUp.click();
      finishUp.click();
    });
    await doneHeading();
    expect(finishRequests(imports)).toHaveLength(1);
    expect(realBatches(imports)).toHaveLength(1);
  });

  it("refreshes the caches once after the run and once after the finish (AC24)", async () => {
    setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const { user } = await toSummary();
    await user.click(importButton());
    await doneHeading();
    await screen.findByText("Records updated.");
    expect(caches.imported).toHaveBeenCalledTimes(2);
  });
});

describe("20.1 AC20 / AC22 — final review fixes", () => {
  const pushA = { id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: "79D0BB3A", sets: [] }] };

  it("I1: Stop during the only batch ends in Stopped — no finish, no routine — with Finish up and no Resume", async () => {
    const { imports, fake } = setupImportRun(auth, { workouts: generateHevyWorkouts(10), routines: [pushA] });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary({ tick: ["Push A"] });
    await user.click(importButton());
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    release();
    expect(await screen.findByRole("heading", { level: 2, name: "Stopped" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(finishRequests(imports)).toEqual([]);
    expect(fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/routines")).toEqual([]);
  });

  it("I2: a run whose creates all come back already_imported still finishes when the server says stale", async () => {
    const workouts = generateHevyWorkouts(3);
    const { imports } = setupImportRun(auth, { workouts });
    const { user } = await toSummary();
    // A lost reply: the server wrote them (and marked records stale) after this tab read the status.
    for (const w of workouts) imports.links.set(w.id, "imported");
    imports.state.recordsStale = true;
    await user.click(importButton());
    await doneHeading();
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(finishRequests(imports)).toHaveLength(1);
  });

  it("code review 1: while the run asks the server whether records are stale, Stop is no longer offered", async () => {
    const workouts = generateHevyWorkouts(3);
    const { imports } = setupImportRun(auth, { workouts });
    const { user } = await toSummary();
    for (const w of workouts) imports.links.set(w.id, "imported");
    let answer: () => void = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    server.use(
      http.get(`${API_BASE_URL}/v1/hevy/status`, async () => {
        await held;
        return HttpResponse.json({ enabled: true, pairCount: 0, linkCount: 3, recordsStale: false });
      }),
    );
    await user.click(importButton());
    expect(await screen.findByText("Updating your records…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    answer();
    await doneHeading();
    expect(finishRequests(imports)).toEqual([]);
  });

  it("I3: a finish that succeeds after the screen is left still refreshes the caches", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const release = imports.gateFinish();
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByText("Updating your records…");
    await user.click(screen.getByRole("link", { name: /Back to Hevy/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Stop the import?" })).getByRole("button", { name: "Stop and leave" }));
    await screen.findByRole("heading", { level: 1, name: "Hevy" });
    const before = caches.imported.mock.calls.length;
    release();
    await waitFor(() => expect(caches.imported.mock.calls.length).toBe(before + 1));
  });
});

describe("20.1 AC22 — no overlap (Review Focus 6)", () => {
  it("Stop during a slow batch, then Finish up: the finish starts after the batch's reply", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(60), imports: { delayMs: 30 } });
    const { user } = await toSummary();
    await user.click(importButton());
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Finish up" }));
    await doneHeading();
    expect(imports.log.map((r) => r.path).slice(-2)).toEqual(["/v1/hevy/import/workouts", "/v1/hevy/import/finish"]);
    expect(imports.concurrency.maxInFlight).toBe(1);
  });

  it("leaving mid-batch, then the banner's finish: it waits for that batch", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(60) });
    const release = imports.gateRealBatch(2);
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByText(/^Importing… 25 of 60/);
    await user.click(screen.getByRole("link", { name: /Back to Hevy/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Stop the import?" })).getByRole("button", { name: "Stop and leave" }));
    await screen.findByRole("heading", { level: 1, name: "Hevy" });
    release();
    const banner = await screen.findByRole("region", { name: "Your last import didn't finish updating your records." });
    await user.click(within(banner).getByRole("button", { name: "Finish the last step" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(imports.log.map((r) => r.path).slice(-2)).toEqual(["/v1/hevy/import/workouts", "/v1/hevy/import/finish"]);
    expect(imports.concurrency.maxInFlight).toBe(1);
  });
});
