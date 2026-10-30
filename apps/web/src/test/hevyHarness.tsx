import type { Exercise } from "@sin/core";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { API_BASE_URL, ME, makeQueryClient } from "./accountHarness";
import { server } from "./msw/server";
import { catalogHandlers } from "./workoutFake";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { catalogKey } from "../features/catalog/constants";
import { ME_QUERY_KEY } from "../features/me/useMe";
import { createPacer } from "../features/hevy/client/pacer";
import { hevyFixtures } from "./hevyFixtures";
import { HevyScreen } from "../features/hevy/HevyScreen";
import { setImportWaitForTests } from "../features/hevy/import/importWait";
import { hevyKeyStore } from "../features/hevy/keyStore";
import { setRetrySleepForTests, setSharedPacerForTests } from "../features/hevy/useHevyClient";
import { memoryStorageAdapter } from "../storage/storage";

/** Test-only helpers for the Hevy screen (Spec 20.0). The file must vi.mock @auth0/auth0-react itself. */

export const HEVY_USER_INFO_URL = "https://api.hevyapp.com/v1/user/info";
export const HEVY_TEMPLATES_URL = "https://api.hevyapp.com/v1/exercise_templates";
export const VALID_KEY = "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbeef";
export const OTHER_KEY = "0b0b0b0b-1111-4222-8333-44445555cafe";
export const USER_ID = ME.id;

/** Hevy's user/info answering `is_pro` and the fixture's username. */
export const userInfoOk = (over: { is_pro?: boolean } = {}) =>
  http.get(HEVY_USER_INFO_URL, () => {
    const reply = hevyFixtures.userInfo() as { data: Record<string, unknown> };
    return HttpResponse.json({ data: { ...reply.data, ...over } });
  });

/** Hevy's template list, served in pages of `perPage`; `hold` keeps a page from ever answering. */
export function templatesHandler(templates: readonly unknown[], opts: { perPage?: number; hold?: number } = {}) {
  const perPage = opts.perPage ?? 100;
  const pageCount = Math.max(1, Math.ceil(templates.length / perPage));
  return http.get(HEVY_TEMPLATES_URL, async ({ request }) => {
    const page = Number(new URL(request.url).searchParams.get("page"));
    if (page === opts.hold) await new Promise<never>(() => {});
    return HttpResponse.json({ page, page_count: pageCount, exercise_templates: templates.slice((page - 1) * perPage, page * perPage) });
  });
}

/** A pacer and retry waits that return at once, so tests never sit out the 600 ms gap, the quiet minute or 1–4 s retries. */
export function setInstantPacing(): void {
  setSharedPacerForTests(createPacer({ now: () => Date.now(), sleep: async () => {} }));
  setRetrySleepForTests(async () => {});
  // Spec 20.1 Phase B: the import run's gap, retry and routine waits; an abort still ends the wait.
  setImportWaitForTests(async (_ms, signal) => {
    await Promise.resolve();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  });
}

export function clearHevyKey(): void {
  hevyKeyStore.remove(USER_ID);
}

/**
 * The Hevy screen, `["me"]` pre-seeded, inside a memory router (useSession needs one) and a catalog holding
 * `catalog` (served by the fake API too, so the refresh on mount answers with the same rows).
 */
export function renderHevyScreen(
  queryClient: QueryClient = makeQueryClient(),
  opts: { catalog?: readonly Exercise[]; path?: string; routes?: { path: string; element: ReactElement }[]; unsyncedCatalog?: true } = {},
): { queryClient: QueryClient; unmount: () => void } {
  const rows = [...(opts.catalog ?? [])];
  server.use(...catalogHandlers(rows));
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  // `unsyncedCatalog`: nothing stored and the list request fails, so the catalog has never synced.
  if (opts.unsyncedCatalog) server.use(http.get(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({}, { status: 503 })));
  const storage = memoryStorageAdapter(opts.unsyncedCatalog ? {} : { [catalogKey(USER_ID)]: JSON.stringify({ version: 1, rows, syncToken: "1.100" }) });
  const router = createMemoryRouter([{ path: "/", element: <HevyScreen /> }, ...(opts.routes ?? [])], { initialEntries: [opts.path ?? "/"] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CatalogProvider userId={USER_ID} storage={storage}>
        <RouterProvider router={router} />
      </CatalogProvider>
    </QueryClientProvider>,
  );
  return { queryClient, unmount: view.unmount };
}
