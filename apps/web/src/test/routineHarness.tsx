// apps/web/src/test/routineHarness.tsx
import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RoutineClientContext } from "../features/routines/queries";
import type { RoutineClient } from "../features/routines/routineClient";

/** A `RoutineClient` whose every operation rejects unless the test overrides it. */
export function fakeRoutineClient(overrides: Partial<RoutineClient> = {}): RoutineClient {
  const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected RoutineClient.${name}()`));
  return {
    list: unexpected("list"),
    get: unexpected("get"),
    create: unexpected("create"),
    replace: unexpected("replace"),
    remove: unexpected("remove"),
    ...overrides,
  } as RoutineClient;
}

export function routineWrapper(queryClient: QueryClient, client: RoutineClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RoutineClientContext.Provider value={client}>{children}</RoutineClientContext.Provider>
      </QueryClientProvider>
    );
  };
}
