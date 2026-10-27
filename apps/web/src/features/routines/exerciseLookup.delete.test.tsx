import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { resetConfigCache } from "../../config";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { API_BASE_URL, CatalogTestProviders, seededStorage, stubWebEnv, USER_ID } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { deferred } from "../../test/workoutHarness";
import { useCatalog } from "../catalog/useCatalog";
import { useExerciseLookup } from "./exerciseLookup";

const origin = makeExercise({ id: exerciseId(1), name: "Bench Press", ownerUserId: null });
const copy = makeExercise({ id: exerciseId(2), name: "My bench", ownerUserId: USER_ID, forkedFromExerciseId: origin.id });
const echo = makeExercise({ id: exerciseId(3), name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });
const EX = `${API_BASE_URL}/v1/exercises`;

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
});
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function setup() {
  let syncs = 0;
  const later = deferred<void>();
  server.use(
    http.get(EX, async () => {
      syncs += 1;
      // The first sync answers at once; the delete's follow-up refresh is held.
      if (syncs > 1) await later.promise;
      return HttpResponse.json({ exercises: [], syncToken: `1.${100 + syncs}` });
    }),
    http.delete(`${EX}/:id`, () => new HttpResponse(null, { status: 204 })),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CatalogTestProviders storage={seededStorage([origin, copy, echo])}>{children}</CatalogTestProviders>
  );
  const hook = renderHook(() => ({ catalog: useCatalog(), lookup: useExerciseLookup() }), { wrapper });
  return { ...hook, later };
}

describe("18.2 AC51 — Removed exercise at once", () => {
  it("a deleted exercise reads Removed exercise before the follow-up sync lands", async () => {
    const { result, later } = setup();
    await waitFor(() => expect(result.current.catalog.state.lastRefreshAt).not.toBeNull());
    expect(result.current.lookup(echo.id)).toMatchObject({ name: "Echo Bike", state: "active" });
    await act(() => result.current.catalog.deleteCustom(echo.id));
    expect(result.current.lookup(echo.id)).toEqual({ name: "Removed exercise", state: "missing", modality: null });
    later.resolve();
  });

  it("deleting a copy leaves the built-in active", async () => {
    const { result, later } = setup();
    await waitFor(() => expect(result.current.catalog.state.lastRefreshAt).not.toBeNull());
    await act(() => result.current.catalog.deleteCustom(copy.id));
    expect(result.current.lookup(origin.id)).toMatchObject({ name: "Bench Press", state: "active" });
    later.resolve();
  });
});
