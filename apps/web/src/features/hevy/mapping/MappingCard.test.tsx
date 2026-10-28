import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { API_BASE_URL, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, useInstantPacer, userInfoOk } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { hevyKeyStore } from "../keyStore";
import { CHOOSE_MARKERS, NO_MARKERS, markersLine, pairedCount } from "../messages";
import { PAIRINGS_PATH } from "../paths";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const pair = (id: string, role: string, exerciseId: string | null = null) => ({
  hevyTemplateId: id,
  hevyTitle: `Title ${id}`,
  hevyType: "weight_reps",
  role,
  exerciseId,
  exerciseActive: exerciseId === null ? null : true,
  measureRule: null,
  exportAs: role === "exercise",
});

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  useInstantPacer();
  clearHevyKey();
  server.use(userInfoOk());
});
afterEach(() => {
  clearHevyKey();
  unstubAccountEnv();
});

describe("20.0 AC17 — the card", () => {
  it("counts exercise pairs only, names the markers, and links to Pairings", async () => {
    server.use(
      http.get(MAPPING_URL, () =>
        HttpResponse.json({
          pairs: [
            pair("A", "exercise", "0192a1b2-0000-7000-8000-000000000001"),
            pair("B", "exercise", "0192a1b2-0000-7000-8000-000000000002"),
            pair("S", "skip"),
            pair("W", "warmup_placeholder"),
            pair("X", "workout_placeholder"),
          ],
          sectionRules: [],
        }),
      ),
    );
    renderHevyScreen();
    expect(await screen.findByText(pairedCount(2))).toBeInTheDocument();
    expect(screen.getByText(markersLine(["Title W", "Title X"]))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review pairings/ })).toHaveAttribute("href", PAIRINGS_PATH);
  });

  it("with no markers it says so and offers to choose them", async () => {
    renderHevyScreen();
    expect(await screen.findByText(NO_MARKERS)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHOOSE_MARKERS })).toBeInTheDocument();
  });

  it("without a key, Load a file is disabled; with one it is enabled", async () => {
    renderHevyScreen();
    expect(await screen.findByRole("button", { name: "Load a file" })).toBeDisabled();
    clearHevyKey();
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    expect(await screen.findByRole("button", { name: "Load a file" })).toBeEnabled();
  });
});
