import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
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

/** Open the editor's picker and pick from the A–Z list (a picked exercise also shows under Recents). */
export async function addFromPicker(user: UserEvent, name: RegExp) {
  await user.click(screen.getByRole("button", { name: "Add exercise" }));
  const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
  const all = within(dialog).getByRole("region", { name: "All exercises" });
  await user.click(within(all).getByRole("button", { name }));
}
