import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
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

import { API_BASE_URL, ME, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { clearHevyKey, setInstantPacing, USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { fakeHevyLink, fakeHevyWrites, hevyApiHandlers, hevyLinkHandlers, sendFixture, WORKOUT_ID } from "../../../test/hevySendFakes";
import { server } from "../../../test/msw/server";
import { memoryStorageAdapter } from "../../../storage/storage";
import { CatalogProvider } from "../../catalog/CatalogProvider";
import { catalogKey } from "../../catalog/constants";
import { ME_QUERY_KEY } from "../../me/useMe";
import { WorkoutClientContext } from "../../workouts/queries";
import type { WorkoutClient } from "../../workouts/workoutClient";
import { HEVY_SEND_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { useHevyLink } from "./useHevyLink";
import { resetSendState, setSendSleepForTests, useSendToHevy } from "./useSendToHevy";

const STATUS_OK = http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json({ enabled: true, pairCount: 2, linkCount: 0, recordsStale: false }));

function setup(opts: { status?: boolean } = {}) {
  const { detail, mapping } = sendFixture();
  const link = fakeHevyLink({ detailOf: (id) => (id === WORKOUT_ID ? detail : null) });
  const hevy = fakeHevyWrites();
  let releaseCreate: () => void = () => {};
  let holdCreate: Promise<void> | null = null;
  const holdNextCreate = () => {
    holdCreate = new Promise<void>((resolve) => (releaseCreate = resolve));
  };
  server.use(
    ...(opts.status === false ? [] : [STATUS_OK]),
    http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json(mapping)),
    ...hevyLinkHandlers(link),
    ...hevyApiHandlers(hevy, { hold: (op) => (op === "create" ? holdCreate ?? undefined : undefined) }),
  );
  const queryClient = makeQueryClient();
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  const workouts = { getById: async () => detail } as unknown as WorkoutClient;
  const storage = memoryStorageAdapter({ [catalogKey(USER_ID)]: JSON.stringify({ version: 1, rows: [], syncToken: "1.100" }) });
  const wrapper = ({ children }: { children: ReactNode }) => {
    const router = createMemoryRouter([{ path: "/", element: <>{children}</> }]);
    return (
      <QueryClientProvider client={queryClient}>
        <CatalogProvider userId={USER_ID} storage={storage}>
          <WorkoutClientContext.Provider value={workouts}>
            <RouterProvider router={router} />
          </WorkoutClientContext.Provider>
        </CatalogProvider>
      </QueryClientProvider>
    );
  };
  return { link, hevy, queryClient, wrapper, holdNextCreate, release: () => releaseCreate() };
}

const linkRequests = (link: ReturnType<typeof fakeHevyLink>, method: string) => link.log.filter((r) => r.method === method);

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  setSendSleepForTests(async () => {});
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  server.use(http.get(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({ exercises: [], syncToken: "1.100" })));
});
afterEach(() => {
  resetSendState(WORKOUT_ID);
  clearHevyKey();
  unstubAccountEnv();
});

describe("20.2 AC2 — link query options", () => {
  it("staleTime 0, no retry, refetch on every mount; the owner's link reads", async () => {
    const s = setup();
    const { result } = renderHook(() => useHevyLink(WORKOUT_ID), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.data?.state).toBe("none"));
    const options = s.queryClient.getQueryCache().find({ queryKey: HEVY_SEND_KEYS.link(WORKOUT_ID) })!.options;
    expect(options).toMatchObject({ staleTime: 0, retry: false, refetchOnMount: "always" });
  });

  it("with the default 404 status (not the owner), no link request is made", async () => {
    const s = setup({ status: false });
    const { result } = renderHook(() => useHevyLink(WORKOUT_ID), { wrapper: s.wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.fetchStatus).toBe("idle");
    expect(linkRequests(s.link, "GET")).toEqual([]);
  });
});

describe("20.2 AC5 — one run per workout", () => {
  it("two hooks starting in the same tick make one begin and one Hevy POST, and share the outcome", async () => {
    const s = setup();
    s.holdNextCreate();
    const a = renderHook(() => useSendToHevy(WORKOUT_ID), { wrapper: s.wrapper });
    const b = renderHook(() => useSendToHevy(WORKOUT_ID), { wrapper: s.wrapper });
    let pa!: Promise<unknown>;
    let pb!: Promise<unknown>;
    act(() => {
      pa = a.result.current.run({ kind: "send" });
      pb = b.result.current.run({ kind: "send" });
    });
    await waitFor(() => expect(a.result.current.pending && b.result.current.pending).toBe(true));
    s.release();
    const [oa, ob] = await Promise.all([pa, pb]);
    expect(oa).toEqual(ob);
    expect(oa).toMatchObject({ kind: "done" });
    expect(linkRequests(s.link, "POST")).toHaveLength(1);
    expect(s.hevy.writes()).toHaveLength(1);
    const mutation = s.queryClient.getMutationCache().find({ mutationKey: HEVY_SEND_KEYS.send(WORKOUT_ID) })!;
    expect(mutation.options).toMatchObject({ networkMode: "always", retry: false });
  });
});

describe("20.2 AC17 — settle refetches the link", () => {
  it("after done, the link query reads sent without a remount", async () => {
    const s = setup();
    const { result } = renderHook(() => ({ link: useHevyLink(WORKOUT_ID), send: useSendToHevy(WORKOUT_ID) }), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.link.data?.state).toBe("none"));
    await act(async () => void (await result.current.send.run({ kind: "send" })));
    await waitFor(() => expect(result.current.link.data?.state).toBe("sent"));
    expect(result.current.send.last).toMatchObject({ kind: "done" });
  });
});

describe("20.2 Review Focus 1 — leaving mid-send", () => {
  it("an unmount between begin and the Hevy reply still completes once and invalidates the link", async () => {
    const s = setup();
    s.holdNextCreate();
    const view = renderHook(() => useSendToHevy(WORKOUT_ID), { wrapper: s.wrapper });
    let p!: Promise<unknown>;
    act(() => {
      p = view.result.current.run({ kind: "send" });
    });
    await waitFor(() => expect(linkRequests(s.link, "POST")).toHaveLength(1));
    view.unmount();
    s.release();
    await expect(p).resolves.toMatchObject({ kind: "done" });
    expect(linkRequests(s.link, "PUT")).toHaveLength(1);
    await waitFor(() => expect(s.queryClient.getQueryState(HEVY_SEND_KEYS.link(WORKOUT_ID))?.isInvalidated ?? true).toBe(true));
    expect(s.link.read(WORKOUT_ID).state).toBe("sent");
  });
});
