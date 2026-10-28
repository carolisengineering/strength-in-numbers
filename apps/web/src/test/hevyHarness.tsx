import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ME, makeQueryClient } from "./accountHarness";
import { ME_QUERY_KEY } from "../features/me/useMe";
import { createPacer } from "../features/hevy/client/pacer";
import { hevyFixtures } from "../features/hevy/client/fixtures";
import { HevyScreen } from "../features/hevy/HevyScreen";
import { hevyKeyStore } from "../features/hevy/keyStore";
import { setRetrySleepForTests, setSharedPacerForTests } from "../features/hevy/useHevyClient";

/** Test-only helpers for the Hevy screen (Spec 20.0 Phase A). The file must vi.mock @auth0/auth0-react itself. */

export const HEVY_USER_INFO_URL = "https://api.hevyapp.com/v1/user/info";
export const VALID_KEY = "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbeef";
export const OTHER_KEY = "0b0b0b0b-1111-4222-8333-44445555cafe";
export const USER_ID = ME.id;

/** Hevy's user/info answering `is_pro` and the fixture's username. */
export const userInfoOk = (over: { is_pro?: boolean } = {}) =>
  http.get(HEVY_USER_INFO_URL, () => {
    const reply = hevyFixtures.userInfo() as { data: Record<string, unknown> };
    return HttpResponse.json({ data: { ...reply.data, ...over } });
  });

/** A pacer and retry waits that return at once, so tests never sit out the 600 ms gap, the quiet minute or 1–4 s retries. */
export function useInstantPacer(): void {
  setSharedPacerForTests(createPacer({ now: () => Date.now(), sleep: async () => {} }));
  setRetrySleepForTests(async () => {});
}

export function clearHevyKey(): void {
  hevyKeyStore.remove(USER_ID);
}

/** The Hevy screen, `["me"]` pre-seeded, inside a memory router (useSession needs one). */
export function renderHevyScreen(queryClient: QueryClient = makeQueryClient()): { queryClient: QueryClient; unmount: () => void } {
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  const router = createMemoryRouter([{ path: "/", element: <HevyScreen /> }]);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, unmount: view.unmount };
}
