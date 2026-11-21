import { act, render, screen } from "@testing-library/react";
import { createContext, useContext } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { clearUserData } from "../../storage/clearUserData";
import { localStorageAdapter } from "../../storage/storage";
import { LandedLine } from "./LandedLine";
import { landedLine } from "./messages";
import { LandedStoreContext } from "./outbox/LandedStoreContext";
import { createLandedStore, type LandedStore } from "./outbox/landedStore";
import { useLandedLeave } from "./useLandedLeave";

const ShowLine = createContext(true);

/** The provider's watcher, always mounted above every screen. */
function Shell({ store }: { store: LandedStore }) {
  useLandedLeave(store);
  return <Outlet />;
}
/** The Workouts screen's line, which the test can unmount and mount again (a resize, a spinner). */
function Line() {
  return useContext(ShowLine) ? <LandedLine /> : null;
}

function setup({ strict = false, lineAlsoOn = null as string | null } = {}) {
  const storage = localStorageAdapter();
  clearUserData(storage);
  const store = createLandedStore({ storage, userId: "u-1" });
  store.add({ workoutId: "w-1", lifts: 2, how: "landed" });
  const children = [{ path: "/app/workouts", element: <Line /> }, ...(lineAlsoOn === null ? [] : [{ path: lineAlsoOn, element: <Line /> }]), { path: "*", element: null }];
  const router = createMemoryRouter([{ element: <Shell store={store} />, children }], { initialEntries: ["/app/workouts"] });
  const ui = (show: boolean) => (
    <ShowLine.Provider value={show}>
      <LandedStoreContext.Provider value={store}>
        <RouterProvider router={router} />
      </LandedStoreContext.Provider>
    </ShowLine.Provider>
  );
  const view = render(ui(true), { reactStrictMode: strict });
  return { store, router, rerender: (show: boolean) => view.rerender(ui(show)) };
}
const line = () => screen.queryByRole("link", { name: landedLine(2) });

afterEach(() => clearUserData(localStorageAdapter()));

describe("06.7 AC27 — minors 636, 668: the saved line leaves on a route change, not an unmount", () => {
  it("under StrictMode's mount, unmount, mount, the line shows and the entry stays", () => {
    const { store } = setup({ strict: true });
    expect(line()).not.toBeNull();
    expect(store.list().map((i) => i.workoutId)).toEqual(["w-1"]);
  });

  it("unmounted and mounted again on the same screen (a resize across 64rem, a spinner): it shows again", () => {
    const { store, rerender } = setup();
    expect(line()).not.toBeNull();
    rerender(false);
    rerender(true);
    expect(line()).not.toBeNull();
    expect(store.list()).toHaveLength(1);
  });

  it("Review Focus 2: going to another screen removes it, so it isn't there on the way back", async () => {
    const { store, router } = setup();
    expect(line()).not.toBeNull();
    await act(() => router.navigate("/app/history"));
    expect(store.list()).toEqual([]);
    await act(() => router.navigate("/app/workouts"));
    expect(line()).toBeNull();
  });

  it("a route change that keeps the line drawn (the desktop list pane beside an open routine) keeps it", async () => {
    const { store, router } = setup({ lineAlsoOn: "/app/workouts/routines/:id" });
    await act(() => router.navigate("/app/workouts/routines/r-1"));
    expect(line()).not.toBeNull();
    expect(store.list()).toHaveLength(1);
  });

  it("an entry that was never drawn survives a route change", async () => {
    const { store, router, rerender } = setup();
    rerender(false);
    store.add({ workoutId: "w-2", lifts: 1, how: "landed" });
    // w-1 was drawn and is left; w-2 never was.
    await act(() => router.navigate("/app/history"));
    expect(store.list().map((i) => i.workoutId)).toEqual(["w-2"]);
  });
});
