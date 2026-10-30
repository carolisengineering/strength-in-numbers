import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { HevyMapping, WorkoutDetail } from "@sin/core";
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
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { API_BASE_URL, ME, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { clearHevyKey, setInstantPacing, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyLink, fakeHevyWrites, hevyApiHandlers, hevyLinkHandlers, sendFixture, WORKOUT_ID } from "../../../test/hevySendFakes";
import { server } from "../../../test/msw/server";
import { finishButton } from "../../../test/sessionHelpers";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { memoryStorageAdapter } from "../../../storage/storage";
import { setHevyAutoPush } from "../../../ui/hevyAutoPush";
import { CatalogProvider } from "../../catalog/CatalogProvider";
import { catalogKey } from "../../catalog/constants";
import { ME_QUERY_KEY } from "../../me/useMe";
import { __resetFinishListeners, emitWorkoutFinished } from "../../workouts/finishEvents";
import { WorkoutClientContext } from "../../workouts/queries";
import type { WorkoutClient } from "../../workouts/workoutClient";
import { hevyKeyStore } from "../keyStore";
import { HevyAutoPush, resetAutoPushState } from "./useHevyAutoPush";
import { resetSendState, setSendSleepForTests } from "./useSendToHevy";

/** The hook alone, in the providers it needs: every request it makes is counted. */
function setupHook(opts: { detail?: WorkoutDetail; mapping?: HevyMapping; owner?: boolean; key?: boolean; elements?: number } = {}) {
  const fixture = sendFixture();
  const detail = opts.detail ?? fixture.detail;
  const mapping = opts.mapping ?? fixture.mapping;
  const link = fakeHevyLink({ detailOf: (id) => (id === WORKOUT_ID ? detail : null) });
  const hevy = fakeHevyWrites();
  // The hook's SIN reads that are not the link (the link fake logs its own) or the detail (`getById`).
  const n = { status: 0, mapping: 0 };
  let releaseCreate: () => void = () => {};
  let holdCreate: Promise<void> | undefined;
  const holdNextCreate = () => {
    holdCreate = new Promise<void>((resolve) => (releaseCreate = resolve));
  };
  server.use(
    ...(opts.owner === false
      ? [
          http.get(`${API_BASE_URL}/v1/hevy/status`, () => {
            n.status += 1;
            return HttpResponse.json({ type: "about:blank", title: "Not found", status: 404 }, { status: 404 });
          }),
        ]
      : [
          http.get(`${API_BASE_URL}/v1/hevy/status`, () => {
            n.status += 1;
            return HttpResponse.json({ enabled: true, pairCount: 2, linkCount: 0, recordsStale: false });
          }),
        ]),
    http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => {
      n.mapping += 1;
      return HttpResponse.json(mapping);
    }),
    ...hevyLinkHandlers(link),
    ...hevyApiHandlers(hevy, { hold: (op) => (op === "create" ? holdCreate : undefined) }),
  );
  if (opts.key !== false) hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  const getById = vi.fn(async () => detail);
  const workouts = { getById } as unknown as WorkoutClient;
  const queryClient = makeQueryClient();
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  const storage = memoryStorageAdapter({ [catalogKey(USER_ID)]: JSON.stringify({ version: 1, rows: [], syncToken: "1.100" }) });
  const elements = Array.from({ length: opts.elements ?? 1 }, (_, i) => <HevyAutoPush key={i} />);
  const router = createMemoryRouter([{ path: "/", element: <>{elements}</> }]);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CatalogProvider userId={USER_ID} storage={storage}>
        <WorkoutClientContext.Provider value={workouts}>
          <RouterProvider router={router} />
        </WorkoutClientContext.Provider>
      </CatalogProvider>
    </QueryClientProvider>,
  );
  return { link, hevy, n, getById, view, holdNextCreate, release: () => releaseCreate() };
}

type Hook = ReturnType<typeof setupHook>;
const linkMethods = (s: Hook) => s.link.log.map((r) => r.method);
const begins = (s: Hook) => s.link.log.filter((r) => r.method === "POST");
/** Lets every read the event started settle (they are MSW round trips). */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  setSendSleepForTests(async () => {});
  server.use(http.get(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({ exercises: [], syncToken: "1.100" })));
  setHevyAutoPush(true);
});
afterEach(() => {
  cleanup();
  resetSendState(WORKOUT_ID);
  resetAutoPushState();
  __resetFinishListeners();
  setHevyAutoPush(false);
  clearHevyKey();
  vi.restoreAllMocks();
  unstubAccountEnv();
});

describe("20.2 AC25 — preconditions", () => {
  it("all met: one link read, one begin, one Hevy POST and one complete, in that order", async () => {
    const s = setupHook();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(linkMethods(s)).toContain("PUT"));
    await settle();
    expect(linkMethods(s)).toEqual(["GET", "POST", "PUT"]);
    expect(s.hevy.writes().map((c) => c.op)).toEqual(["create"]);
    // The checks' read, then the send sequence's own fresh read right before its begin (minor 263 shares only the mapping).
    expect(s.getById).toHaveBeenCalledTimes(2);
  });

  it("off: no request at all", async () => {
    setHevyAutoPush(false);
    const s = setupHook();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await settle();
    expect(s.n).toEqual({ status: 0, mapping: 0 });
    expect(s.getById).not.toHaveBeenCalled();
    expect(s.link.log).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("not the owner (status 404): nothing after the status", async () => {
    const s = setupHook({ owner: false });
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(s.n.status).toBe(1));
    await settle();
    expect(s.getById).not.toHaveBeenCalled();
    expect(s.link.log).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("no key on this device (the preference outlives logout, the key doesn't): no request at all", async () => {
    const s = setupHook({ key: false });
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await settle();
    expect(s.n).toEqual({ status: 0, mapping: 0 });
    expect(s.getById).not.toHaveBeenCalled();
    expect(s.link.log).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("offline (Review Focus 5): no hevy-link request at all, so no claim is left", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const s = setupHook();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await settle();
    expect(s.link.log).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("a live workout (no endedAt): no begin", async () => {
    const s = setupHook({ detail: sendFixture({ endedAt: null }).detail });
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(s.getById).toHaveBeenCalled());
    await settle();
    expect(s.link.log).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("an unmatched exercise (O1): no begin", async () => {
    const { mapping } = sendFixture();
    const s = setupHook({ mapping: { ...mapping, pairs: mapping.pairs.slice(0, 1) } });
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(s.n.mapping).toBe(1));
    await settle();
    expect(s.link.log).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("a link that is not none (sent): the read, then nothing", async () => {
    const s = setupHook();
    s.link.link(WORKOUT_ID, "h9");
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(linkMethods(s)).toEqual(["GET"]));
    await settle();
    expect(linkMethods(s)).toEqual(["GET"]);
    expect(s.hevy.calls).toEqual([]);
  });

  it("Review Focus 2: the mapping was never loaded in this page view, so it is fetched (not taken as unmapped)", async () => {
    const s = setupHook();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(linkMethods(s)).toContain("PUT"));
    // Fetched for the check (the cache was empty); the send builds from that read (minor 263).
    expect(s.n.mapping).toBe(1);
  });

  it("a rejected read (the workout deleted right after the finish: 404) is silent", async () => {
    const s = setupHook();
    s.getById.mockRejectedValueOnce(new Error("gone"));
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(s.getById).toHaveBeenCalled());
    await settle();
    expect(s.link.log).toEqual([]);
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});

describe("20.2 AC25 — create only", () => {
  it("a workout already linked and changed since: no begin, no Hevy PUT", async () => {
    const s = setupHook();
    s.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(linkMethods(s)).toEqual(["GET"]));
    await settle();
    expect(begins(s)).toEqual([]);
    expect(s.hevy.calls).toEqual([]);
  });
});

describe("20.2 AC28 — exactly once", () => {
  it("two mounted elements and the event emitted twice in one tick: one begin and one Hevy POST", async () => {
    const s = setupHook({ elements: 2 });
    s.holdNextCreate();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(s.hevy.calls.length + begins(s).length).toBeGreaterThan(0));
    await settle();
    s.release();
    await waitFor(() => expect(linkMethods(s)).toContain("PUT"));
    expect(begins(s)).toHaveLength(1);
    expect(s.hevy.writes()).toHaveLength(1);
  });

  it("a second event after the first completed reads sent, so there is no second begin", async () => {
    const s = setupHook();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(linkMethods(s)).toContain("PUT"));
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(linkMethods(s).filter((m) => m === "GET").length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(begins(s)).toHaveLength(1);
    expect(s.hevy.writes()).toHaveLength(1);
  });
});

describe("20.2 AC26 — never blocks", () => {
  it("emit returns before any request resolves", () => {
    const s = setupHook();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    expect(s.link.log).toEqual([]);
    expect(s.n).toEqual({ status: 0, mapping: 0 });
  });

  it("Review Focus 3: unmounting right after the event still reaches complete", async () => {
    const s = setupHook();
    s.holdNextCreate();
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    await waitFor(() => expect(begins(s)).toHaveLength(1));
    s.view.unmount();
    s.release();
    await waitFor(() => expect(linkMethods(s)).toContain("PUT"));
  });
});

describe("20.2 AC26 — never blocks: Finish in the app", () => {
  /** The real app: one live workout matched in full; the link server reads the fake's finished map. */
  function setupApp() {
    const { detail, mapping } = sendFixture({ endedAt: null });
    const fake = createWorkoutFake({ active: detail });
    prepareApp({ auth, fake });
    setHevyAutoPush(true);
    const link = fakeHevyLink({ detailOf: (id) => fake.state.finished.get(id) ?? null });
    const hevy = fakeHevyWrites();
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json({ enabled: true, pairCount: 2, linkCount: 0, recordsStale: false })),
      http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json(mapping)),
      ...hevyLinkHandlers(link),
      ...hevyApiHandlers(hevy, { hold: (op) => (op === "create" ? hold : undefined) }),
    );
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    return { fake, link, hevy, release: () => release() };
  }

  afterEach(() => cleanupApp());

  async function finish() {
    const app = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    await app.user.click(finishButton());
    await app.user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe(`/app/workouts/${WORKOUT_ID}`));
    return app;
  }

  it("the summary shows Sending to Hevy… while it runs, then Sent to Hevy; no sheet or dialog opens", async () => {
    const s = setupApp();
    await finish();
    const region = await screen.findByRole("region", { name: "Hevy" });
    expect(await within(region).findByText("Sending to Hevy…")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    s.release();
    expect(await within(region).findByText(/^Sent to Hevy/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(s.link.log.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("a Hevy 400: the section shows the AC8 sentence and the Send button", async () => {
    const s = setupApp();
    s.hevy.fail("create", "400");
    s.release();
    await finish();
    const region = await screen.findByRole("region", { name: "Hevy" });
    expect(await within(region).findByText("Hevy didn't accept this workout.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Send to Hevy" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("20.2 AC27 — no background", () => {
  it("with the preference off, an event schedules no timer", () => {
    setHevyAutoPush(false);
    setupHook();
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    emitWorkoutFinished({ workoutId: WORKOUT_ID });
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });
});
