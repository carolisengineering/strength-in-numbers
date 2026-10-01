import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { resetConfigCache } from "../../config";
import { memoryStorageAdapter } from "../../storage/storage";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import {
  API_BASE_URL,
  CatalogTestProviders,
  seededStorage,
  stubWebEnv,
  USER_ID,
} from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { useCatalogStore } from "./CatalogProvider";
import { useCatalog } from "./useCatalog";

const EXERCISES_URL = `${API_BASE_URL}/v1/exercises`;

const squat = makeExercise({ id: exerciseId(1), name: "Back Squat" });
const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });
const fork = makeExercise({
  id: exerciseId(3),
  name: "My Bench Press",
  ownerUserId: USER_ID,
  forkedFromExerciseId: exerciseId(2),
});

let syncCalls = 0;

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  syncCalls = 0;
  server.use(
    http.get(EXERCISES_URL, () => {
      syncCalls += 1;
      return HttpResponse.json({ exercises: [], syncToken: "1.101" });
    }),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function Probe() {
  const { state, visible, recents, recordPick } = useCatalog();
  return (
    <div>
      <p data-testid="status">{state.status}</p>
      <p data-testid="visible">{visible.map((r) => r.name).join(",")}</p>
      <p data-testid="recents">{recents.map((r) => r.name).join(",")}</p>
      <button type="button" onClick={() => recordPick(exerciseId(1))}>
        pick squat
      </button>
    </div>
  );
}

describe("AC22 — useCatalog() reflects the store, including picks", () => {
  it("exposes the visible rows sorted A–Z with forked origins hidden", async () => {
    const storage = seededStorage([fork, squat, bench]);

    render(
      <CatalogTestProviders storage={storage}>
        <Probe />
      </CatalogTestProviders>,
    );

    expect(screen.getByTestId("visible")).toHaveTextContent("Back Squat,My Bench Press");
    await waitFor(() => expect(syncCalls).toBe(1));
  });

  it("re-renders after recordPick", async () => {
    const storage = seededStorage([squat, bench]);
    render(
      <CatalogTestProviders storage={storage}>
        <Probe />
      </CatalogTestProviders>,
    );
    expect(screen.getByTestId("recents")).toBeEmptyDOMElement();

    await userEvent.setup().click(screen.getByRole("button", { name: "pick squat" }));

    expect(screen.getByTestId("recents")).toHaveTextContent("Back Squat");
    await waitFor(() => expect(syncCalls).toBe(1));
  });

  it("mounting calls refresh once, however many components use the hook", async () => {
    const storage = seededStorage([squat]);
    render(
      <CatalogTestProviders storage={storage}>
        <Probe />
        <Probe />
      </CatalogTestProviders>,
    );

    await waitFor(() => expect(screen.getAllByTestId("status")[0]).toHaveTextContent("idle"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(syncCalls).toBe(1);
  });

  it("<CatalogProvider> keeps one store across re-renders with the same userId", async () => {
    const storage = memoryStorageAdapter();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CatalogTestProviders storage={storage}>{children}</CatalogTestProviders>
    );

    const { result, rerender } = renderHook(() => useCatalogStore(), { wrapper });
    const first = result.current;
    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it("useCatalog() outside a provider throws an error that names the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useCatalog())).toThrow(/<CatalogProvider>/);
  });
});
