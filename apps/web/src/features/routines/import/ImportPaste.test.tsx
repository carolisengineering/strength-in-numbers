import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { screen, within } from "@testing-library/react";
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

import { HIRAYA_TEXT, trackPaths } from "../../../test/importFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { makeRoutine, routineId } from "../../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { LIMIT_MESSAGE } from "../messages";
import { IMPORT_EDIT_PATH, IMPORT_PATH, WORKOUTS_PATH } from "../paths";
import {
  HOW_TO_INTRO,
  HOW_TO_STEPS,
  NO_EXERCISES,
  NOTHING_TO_READ,
  OPEN_ANYWAY,
  PASTE_TITLE,
  PRIVACY_LINE,
  READ_BUTTON,
  TEXT_LABEL,
  TOO_LONG,
  foundLine,
} from "./messages";

afterEach(() => cleanupApp());

describe("10.4 AC21 — paste screen", () => {
  it("copy, landmarks and the blank rule", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    const { user } = renderApp(IMPORT_PATH);
    expect(await screen.findByRole("heading", { level: 1, name: PASTE_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Workouts" })).toHaveAttribute("href", WORKOUTS_PATH);
    expect(screen.getByLabelText(TEXT_LABEL).tagName).toBe("TEXTAREA");
    expect(within(screen.getByRole("list", { name: HOW_TO_INTRO })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([...HOW_TO_STEPS]);
    expect(screen.getByText(PRIVACY_LINE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: READ_BUTTON })).toBeDisabled();
    await user.click(screen.getByLabelText(TEXT_LABEL));
    await user.paste("   \n  ");
    expect(screen.getByRole("button", { name: READ_BUTTON })).toBeDisabled();
  });

  it("over 40,000 characters: the static message, no truncation, no navigation", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    const { router, user } = renderApp(IMPORT_PATH);
    const text = "Strength\n" + "a".repeat(40_000);
    await user.click(await screen.findByLabelText(TEXT_LABEL));
    await user.paste(text);
    await user.click(screen.getByRole("button", { name: READ_BUTTON }));
    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(screen.getByText(TOO_LONG)).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(TEXT_LABEL)).toHaveValue(text);
    expect(router.state.location.pathname).toBe(IMPORT_PATH);
  });
});

describe("10.4 AC19 — the paste screen at the routine limit", () => {
  it("shows LIMIT_MESSAGE and keeps Read workout disabled", async () => {
    const routines = Array.from({ length: ROUTINES_PER_USER_MAX }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${i}` }));
    prepareApp({ auth, fake: createWorkoutFake({ routines }) });
    const { user } = renderApp(IMPORT_PATH);
    expect(await screen.findByText(LIMIT_MESSAGE)).toBeInTheDocument();
    await user.click(screen.getByLabelText(TEXT_LABEL));
    await user.paste(HIRAYA_TEXT);
    expect(screen.getByRole("button", { name: READ_BUTTON })).toBeDisabled();
    expect(screen.getByRole("button", { name: READ_BUTTON })).toHaveAccessibleDescription(LIMIT_MESSAGE);
  });
});

describe("10.4 AC22 — read outcomes with no exercises", () => {
  async function readText(text: string) {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const app = renderApp(IMPORT_PATH);
    const seen = trackPaths(app.router);
    await app.user.click(await screen.findByLabelText(TEXT_LABEL));
    await app.user.paste(text);
    await app.user.click(screen.getByRole("button", { name: READ_BUTTON }));
    return { ...app, fake, seen };
  }

  it("sections or notes but no exercises: the panel names what was found and offers the editor", async () => {
    const { user, fake, seen } = await readText("11:41\nWarmup\n400m easy Run\nthen 2 Rounds\n- 10 Arm Circles\nCooldown\nWalk it off.\nHome");
    expect(await screen.findByText(NO_EXERCISES)).toBeInTheDocument();
    expect(screen.getByText("Found 2 sections: Warmup, Cooldown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: OPEN_ANYWAY }));
    expect(seen).toContain(IMPORT_EDIT_PATH); // Phase B's edit route redirects back; Phase C lands in the editor
    expect(fake.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("nothing after cleaning: no continue", async () => {
    const { seen } = await readText("11:41\nHome\nNO SCORE");
    expect(await screen.findByText(NOTHING_TO_READ)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OPEN_ANYWAY })).toBeNull();
    expect(seen).toEqual([]);
  });

  it("reading never throws on hostile text", async () => {
    await readText("\u0000\ud800" + "-".repeat(39_000));
    expect(await screen.findByText(NO_EXERCISES)).toBeInTheDocument();
    expect(screen.getByText("Found a note, but no sections.")).toBeInTheDocument();
  });

  it("foundLine counts sections", () => {
    expect([foundLine([]), foundLine(["Warmup"]), foundLine(["Warmup", "Cooldown"])]).toEqual([
      "Found a note, but no sections.",
      "Found 1 section: Warmup",
      "Found 2 sections: Warmup, Cooldown",
    ]);
  });
});
