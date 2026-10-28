import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));
const saved = vi.hoisted(() => ({ blobs: [] as { blob: Blob; filename: string }[] }));
vi.mock("../../account/saveBlob", () => ({ saveBlob: (blob: Blob, filename: string) => void saved.blobs.push({ blob, filename }) }));

import { API_BASE_URL, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, setInstantPacing, userInfoOk } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { hevyKeyStore } from "../keyStore";
import { CHOOSE_MARKERS, DOWNLOAD_FAILED, MAPPING_OFFLINE, NO_MARKERS, markersLine, pairedCount } from "../messages";
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
  setInstantPacing();
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

describe("20.0 AC23 — a download whose re-read fails saves nothing (final review)", () => {
  it.each([
    ["offline", () => HttpResponse.error(), MAPPING_OFFLINE],
    ["a 500", () => HttpResponse.json({ type: "x/internal", title: "t", status: 500, detail: "d", instance: "i" }, { status: 500, headers: { "content-type": "application/problem+json" } }), DOWNLOAD_FAILED],
  ])("%s: no file, and the status line says why", async (_label, reply, sentence) => {
    saved.blobs = [];
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ pairs: [pair("A", "exercise", "0192a1b2-0000-7000-8000-000000000001")], sectionRules: [] }), { once: true }));
    renderHevyScreen();
    await screen.findByText(pairedCount(1));
    server.use(http.get(MAPPING_URL, reply));
    await userEvent.click(screen.getByRole("button", { name: "Download file" }));
    await waitFor(() => expect(screen.getByTestId("hevy-mapping-status")).toHaveTextContent(sentence));
    expect(saved.blobs).toEqual([]);
  });
});
