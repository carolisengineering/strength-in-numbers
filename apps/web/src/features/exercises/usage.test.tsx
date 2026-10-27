import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { resetConfigCache } from "../../config";
import { memoryStorageAdapter } from "../../storage/storage";
import { exerciseId } from "../../test/catalogFixtures";
import { API_BASE_URL, CatalogTestProviders, stubWebEnv } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { EXERCISE_KEYS } from "./keys";
import { useExerciseUsage } from "./usage";

const USAGE_URL = `${API_BASE_URL}/v1/exercises/usage`;

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  server.use(http.get(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({ exercises: [], syncToken: "1.101" })));
});

afterEach(() => {
  onlineManager.setOnline(true);
  resetConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function setup() {
  const storage = memoryStorageAdapter({});
  const set = vi.spyOn(storage, "set");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CatalogTestProviders storage={storage}>{children}</CatalogTestProviders>
  );
  const hook = renderHook(() => ({ usage: { ...useExerciseUsage() }, qc: useQueryClient() }), { wrapper });
  return { ...hook, set };
}

describe("18.2 AC7 — the usage query", () => {
  it("maps the served pairs under ['exercises','usage'] and stores nothing", async () => {
    server.use(
      http.get(USAGE_URL, () =>
        HttpResponse.json({
          exercises: [
            { rootId: exerciseId(1), lastLoggedOn: "2026-10-24" },
            { rootId: exerciseId(2), lastLoggedOn: "2026-10-01" },
          ],
        }),
      ),
    );
    const { result, set } = setup();
    await waitFor(() => expect(result.current.usage.isSuccess).toBe(true));
    expect(EXERCISE_KEYS.usage).toEqual(["exercises", "usage"]);
    expect([...(result.current.usage.data ?? new Map()).entries()]).toEqual([
      [exerciseId(1), "2026-10-24"],
      [exerciseId(2), "2026-10-01"],
    ]);
    const options = result.current.qc.getQueryCache().find({ queryKey: EXERCISE_KEYS.usage })?.options;
    expect(options).toMatchObject({ staleTime: 0, retry: false, networkMode: "always" });
    // The catalog store may persist its own rows; nothing else is written.
    expect(set.mock.calls.every(([key]) => key.startsWith("sin:catalog:"))).toBe(true);
  });

  it("fails on a body that does not match the schema", async () => {
    server.use(http.get(USAGE_URL, () => HttpResponse.json({ exercises: [{ rootId: 7 }] })));
    const { result } = setup();
    await waitFor(() => expect(result.current.usage.status).toBe("error"));
  });

  it("fails offline instead of pausing", async () => {
    onlineManager.setOnline(false);
    server.use(http.get(USAGE_URL, () => HttpResponse.error()));
    const { result } = setup();
    await waitFor(() => expect(result.current.usage.status).toBe("error"));
    expect(result.current.usage.fetchStatus).toBe("idle");
  });
});
