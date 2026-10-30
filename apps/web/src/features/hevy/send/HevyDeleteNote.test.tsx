import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { API_BASE_URL, ME, makeQueryClient } from "../../../test/accountHarness";
import { cleanupSendScreen, setupSendScreen, WORKOUT_ID } from "../../../test/hevySendHarness";
import { server } from "../../../test/msw/server";
import { renderApp } from "../../../test/workoutHarness";
import { ME_QUERY_KEY } from "../../me/useMe";
import { LastSetDialog } from "../../workouts/edit/LastSetDialog";

afterEach(() => {
  cleanup();
  cleanupSendScreen();
});

const NOTE = "This workout is also in Hevy. Deleting it here doesn't remove it from Hevy; delete it there yourself.";
const linkReads = (s: ReturnType<typeof setupSendScreen>) => s.link.log.filter((r) => r.method === "GET");

async function openDelete() {
  const view = renderApp(`/app/history/${WORKOUT_ID}`);
  await view.user.click(await screen.findByRole("button", { name: "Workout menu" }));
  await view.user.click(await screen.findByRole("button", { name: "Delete workout" }));
  return { ...view, dialog: await screen.findByRole("dialog", { name: "Delete this workout?" }) };
}

describe("20.2 AC18 — delete note", () => {
  it("the finished-workout dialog says the Hevy copy stays; Cancel keeps the focus; Delete still deletes", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9");
    const { dialog, user, router } = await openDelete();
    expect(await within(dialog).findByText(NOTE)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/history"));
    expect(s.fake.state.finished.has(WORKOUT_ID)).toBe(false);
  });

  it("no note for a workout not in Hevy, or a link read that fails", async () => {
    setupSendScreen(auth);
    const { dialog } = await openDelete();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(dialog).queryByText(NOTE)).toBeNull();
    cleanup();
    server.use(http.get(`${API_BASE_URL}/v1/workouts/:id/hevy-link`, () => HttpResponse.json({ type: "about:blank", title: "Boom", status: 500 }, { status: 500 })));
    const again = await openDelete();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(again.dialog).queryByText(NOTE)).toBeNull();
    expect(within(again.dialog).queryByRole("alert")).toBeNull();
  });

  it("not the owner: no note and no link request", async () => {
    const s = setupSendScreen(auth, { owner: false });
    const { dialog } = await openDelete();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(dialog).queryByText(NOTE)).toBeNull();
    expect(linkReads(s)).toEqual([]);
  });

  it("the edit screen's 'Delete this whole workout instead?' shows the note too; focus on Keep it", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9");
    const queryClient = makeQueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    // The dialog alone, inside the app's providers (the owner status and the link come from the harness's server).
    const { CatalogProvider } = await import("../../catalog/CatalogProvider");
    const { memoryStorageAdapter } = await import("../../../storage/storage");
    const router = createMemoryRouter([{ path: "/", element: <LastSetDialog open busy={false} workoutId={WORKOUT_ID} onKeep={() => {}} onDelete={() => {}} /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <CatalogProvider userId={ME.id} storage={memoryStorageAdapter()}>
          <RouterProvider router={router} />
        </CatalogProvider>
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete this whole workout instead?" });
    expect(await within(dialog).findByText(NOTE)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep it" }));
  });

  it("the link is read only once the dialog opens", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9");
    renderApp(`/app/history/${WORKOUT_ID}`);
    await screen.findByRole("region", { name: "Hevy" });
    const before = linkReads(s).length;
    const { dialog } = await openDelete();
    expect(await within(dialog).findByText(NOTE)).toBeInTheDocument();
    expect(linkReads(s).length).toBeGreaterThan(before);
  });
});
