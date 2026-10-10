import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// The editor's post-save navigation (replace onto a preview) is swallowed, so the editor stays mounted:
// the window a slow phone opens between a successful save and the editor unmounting.
vi.mock("react-router", async (original) => {
  const real = await original<typeof import("react-router")>();
  return {
    ...real,
    useNavigate: () => {
      const navigate = real.useNavigate();
      return ((to: unknown, options?: { replace?: boolean }) =>
        typeof to === "string" && /^\/app\/workouts\/routines\/[^/]+$/.test(to) && options?.replace
          ? undefined
          : navigate(to as never, options)) as ReturnType<typeof real.useNavigate>;
    },
  };
});

import { catalog } from "../../test/routineFixtures";
import { addFromPicker } from "../../test/routineHarness";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

describe("10.0 AC32 — a successful save stays latched", () => {
  it("a second Save after the first succeeded sends nothing", async () => {
    const fake = createWorkoutFake({ catalog });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp("/app/workouts/routines/new");
    await screen.findByRole("heading", { level: 1, name: "New routine" });
    await user.type(screen.getByLabelText("Name"), "Legs");
    await addFromPicker(user, /Bench Press/);
    const save = screen.getByRole("button", { name: "Save" });
    await user.click(save);
    await waitFor(() => expect(fake.state.routines.size).toBe(1));
    save.click(); // the late second tap, on the still-mounted button
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/routines")).toHaveLength(1);
  });
});
