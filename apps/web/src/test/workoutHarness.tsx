import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi, type Mock } from "vitest";
import type { Exercise } from "@sin/core";
import { routes } from "../app/router";
import { resetConfigCache } from "../config";
import { catalogKey } from "../features/catalog/constants";
import { clearUserData } from "../storage/clearUserData";
import { localStorageAdapter } from "../storage/storage";
import { WorkoutClientContext } from "../features/workouts/queries";
import type { WorkoutClient } from "../features/workouts/workoutClient";
import { API_BASE_URL, USER_ID, stubWebEnv } from "./catalogHarness";
import { server } from "./msw/server";
import { catalogHandlers, type WorkoutFake } from "./workoutFake";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** A `WorkoutClient` whose every operation throws unless the test overrides it. */
export function fakeClient(overrides: Partial<WorkoutClient> = {}): WorkoutClient {
  const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected WorkoutClient.${name}()`));
  return {
    getActive: unexpected("getActive"),
    getById: unexpected("getById"),
    start: unexpected("start"),
    finish: unexpected("finish"),
    deleteWorkout: unexpected("deleteWorkout"),
    addExercise: unexpected("addExercise"),
    moveExercise: unexpected("moveExercise"),
    removeExercise: unexpected("removeExercise"),
    createSet: unexpected("createSet"),
    updateSet: unexpected("updateSet"),
    deleteSet: unexpected("deleteSet"),
    ...overrides,
  } as WorkoutClient;
}

/** A hook/component wrapper: a QueryClient plus an injected `WorkoutClient`. */
export function wrapperWith(queryClient: QueryClient, client: WorkoutClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <WorkoutClientContext.Provider value={client}>{children}</WorkoutClientContext.Provider>
      </QueryClientProvider>
    );
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---- whole-app rendering ------------------------------------------------------------------------
// Each test file still owns `vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }))`
// (`vi.mock` is hoisted per file) and passes its hoisted `auth` object in here.

export interface AuthStub {
  state: {
    isLoading: boolean;
    isAuthenticated: boolean;
    error: Error | undefined;
    loginWithRedirect: Mock;
    logout: Mock;
    getAccessTokenSilently: Mock;
  };
}

export interface PrepareAppOptions {
  auth: AuthStub;
  fake: WorkoutFake;
  /** Catalog rows: seeded into storage (instantly visible) and served by the catalog endpoints. */
  catalog?: Exercise[];
  unitPreference?: "kg" | "lb";
}

/** Call at the start of a test (after creating its fake). Pair with `cleanupApp()` in `afterEach`. */
export function prepareApp({ auth, fake, catalog = [], unitPreference = "kg" }: PrepareAppOptions): void {
  stubWebEnv();
  // Through the StorageAdapter seam: Spec 04.0 AC7's source scan forbids any other module naming the
  // browser storage globals.
  const storage = localStorageAdapter();
  clearUserData(storage);
  storage.set(catalogKey(USER_ID), JSON.stringify({ version: 1, rows: catalog, syncToken: "1.100" }));
  auth.state.isLoading = false;
  auth.state.isAuthenticated = true;
  auth.state.loginWithRedirect = vi.fn();
  auth.state.logout = vi.fn();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  server.use(
    ...catalogHandlers(catalog),
    ...fake.handlers,
    http.get(`${API_BASE_URL}/v1/me`, () =>
      HttpResponse.json({
        id: USER_ID,
        email: "lifter@example.com",
        displayName: "Sam",
        unitPreference,
        timezone: "Europe/London",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ),
  );
}

export function cleanupApp(): void {
  clearUserData(localStorageAdapter());
  resetConfigCache();
  vi.unstubAllEnvs();
}

/** Render the real route table at `path`, inside the real providers. */
export function renderApp(path: string) {
  const queryClient = makeQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, user: userEvent.setup() };
}
