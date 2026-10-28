import { QueryClientProvider, onlineManager, type QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { API_BASE_URL, ME, makeQueryClient, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { USER_ID, VALID_KEY, clearHevyKey, setInstantPacing, userInfoOk } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { ME_QUERY_KEY } from "../../me/useMe";
import { HEVY_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { useHevyKey } from "../useHevyKey";
import { useHevyMapping } from "./useHevyMapping";
import { useHevyTemplates } from "./useHevyTemplates";
import { useMappingMutations, type PairInput } from "./useMappingMutations";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const TEMPLATES_URL = "https://api.hevyapp.com/v1/exercise_templates";
const PAIR: PairInput = {
  hevyTemplateId: "T1",
  hevyTitle: "Bench Press (Barbell)",
  hevyType: "weight_reps",
  role: "exercise",
  exerciseId: "0192a1b2-0000-7000-8000-000000000001",
  measureRule: null,
  exportAs: true,
};
const template = (id: string) => ({ id, title: `T ${id}`, type: "weight_reps", is_custom: false, primary_muscle_group: "chest", secondary_muscle_groups: [], equipment: "barbell" });

/** The hooks under one QueryClient, inside a router (useSession needs one), with `["me"]` seeded. */
function wrapperFor(queryClient: QueryClient) {
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  return function Wrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter([{ path: "/", element: <>{children}</> }]);
    return (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  };
}

let requests: { method: string; url: string; body: unknown }[] = [];
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  window.localStorage.clear();
  requests = [];
  server.events.on("request:start", async ({ request }) => {
    const body = request.method === "GET" ? null : await request.clone().json().catch(() => null);
    requests.push({ method: request.method, url: request.url, body });
  });
});
afterEach(() => {
  server.events.removeAllListeners();
  clearHevyKey();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  unstubAccountEnv();
});

describe("20.0 AC17 — mapping read", () => {
  it("reads under [hevy, mapping]", async () => {
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ pairs: [{ ...PAIR, exerciseActive: true }], sectionRules: [] })));
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useHevyMapping(), { wrapper: wrapperFor(queryClient) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(HEVY_KEYS.mapping).toEqual(["hevy", "mapping"]);
    expect(queryClient.getQueryData(HEVY_KEYS.mapping)).toEqual({ pairs: [{ ...PAIR, exerciseActive: true }], sectionRules: [] });
  });

  it("a reply that fails the schema is a failed query", async () => {
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ pairs: "nope" })));
    const { result } = renderHook(() => useHevyMapping(), { wrapper: wrapperFor(makeQueryClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("20.0 AC22 / AC25 — writes", () => {
  it("PUT and PATCH send exactly what was passed; the cache takes the response and the status is invalidated", async () => {
    const reply = { pairs: [{ ...PAIR, exerciseActive: true }], sectionRules: [{ name: "Warmup", treatment: "warmup_placeholder" }] };
    server.use(http.put(MAPPING_URL, () => HttpResponse.json(reply)), http.patch(MAPPING_URL, () => HttpResponse.json(reply)));
    const queryClient = makeQueryClient();
    queryClient.setQueryData(HEVY_KEYS.status(USER_ID), { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false });
    const { result } = renderHook(() => useMappingMutations(), { wrapper: wrapperFor(queryClient) });

    const body = { pairs: [PAIR], sectionRules: [{ name: "Warmup", treatment: "warmup_placeholder" as const }] };
    await act(() => result.current.put.mutateAsync(body));
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual(body);
    expect(queryClient.getQueryData(HEVY_KEYS.mapping)).toEqual(reply);
    expect(queryClient.getQueryState(HEVY_KEYS.status(USER_ID))?.isInvalidated).toBe(true);

    await act(() => result.current.patch.mutateAsync({ remove: ["T9"] }));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ remove: ["T9"] });
  });

  it("offline, a write fails at once instead of pausing, and is never retried", async () => {
    let calls = 0;
    server.use(http.put(MAPPING_URL, () => {
      calls += 1;
      return HttpResponse.error();
    }));
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useMappingMutations(), { wrapper: wrapperFor(makeQueryClient()) });
    await act(async () => {
      await result.current.put.mutateAsync({ pairs: [], sectionRules: [] }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.put.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe("20.0 AC19 — templates in memory only", () => {
  it("flattens every page in order and reports each", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    server.use(
      http.get(TEMPLATES_URL, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        return HttpResponse.json({ page, page_count: 3, exercise_templates: [template(`p${page}a`), template(`p${page}b`)] });
      }),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const pages: string[] = [];
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useHevyTemplates({ onPage: ({ page, pageCount }) => void pages.push(`${page}/${pageCount}`) }), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((t) => t.id)).toEqual(["p1a", "p1b", "p2a", "p2b", "p3a", "p3b"]);
    expect(pages).toEqual(["1/3", "2/3", "3/3"]);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.queryKey))).not.toContain(VALID_KEY);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("without a key the query does not run", async () => {
    const { result } = renderHook(() => useHevyTemplates(), { wrapper: wrapperFor(makeQueryClient()) });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(requests.filter((r) => r.url.startsWith(TEMPLATES_URL))).toEqual([]);
  });

  it("saving a new key removes the cached templates", async () => {
    server.use(userInfoOk());
    const queryClient = makeQueryClient();
    queryClient.setQueryData(HEVY_KEYS.templates, [template("old")]);
    const { result } = renderHook(() => useHevyKey(), { wrapper: wrapperFor(queryClient) });
    await act(async () => {
      await result.current.save(VALID_KEY, { remember: false });
    });
    expect(queryClient.getQueryData(HEVY_KEYS.templates)).toBeUndefined();
  });
});
