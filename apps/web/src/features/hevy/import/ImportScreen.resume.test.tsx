import { cleanup, screen, within } from "@testing-library/react";
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

import type { HevyImportBatch } from "@sin/core";

import { setInstantPacing, USER_ID } from "../../../test/hevyHarness";
import { generateHevyWorkouts } from "../../../test/hevyImportFakes";
import { importButton, realBatches, setupImportRun, toSummary } from "../../../test/hevyImportRun";
import { cleanupApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
import { resetImportLaneForTests } from "./importLane";

beforeEach(() => setInstantPacing());
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  resetImportLaneForTests();
  cleanupApp();
});

const counts = () => within(screen.getByRole("list", { name: /workouts read$/ }));
const doneHeading = () => screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });

describe("20.1 AC21 — resume after a close", () => {
  it("a second run imports only what is left, never re-sends an imported workout, and a third has nothing new", async () => {
    const workouts = generateHevyWorkouts(125);
    const first = setupImportRun(auth, { workouts });
    const imports = first.imports;
    const sent: HevyImportBatch[] = [];

    // Run 1: three of five batches, then Stop, then the tab goes away.
    const release = imports.gateRealBatch(3);
    let view = await toSummary();
    await view.user.click(importButton());
    await screen.findByText(/^Importing… 50 of 125/);
    await view.user.click(screen.getByRole("button", { name: "Stop" }));
    release();
    await screen.findByRole("heading", { level: 2, name: "Stopped" });
    sent.push(...realBatches(imports));
    const created = imports.links.size;
    expect(created).toBe(75);
    cleanup();

    // Run 2: a fresh read and dry run on the same server.
    imports.reset();
    setupImportRun(auth, { workouts, sharedImports: imports });
    view = await toSummary();
    expect(counts().getByText(`${created} already in SIN`)).toBeInTheDocument();
    expect(counts().getByText("50 will be imported")).toBeInTheDocument();
    await view.user.click(importButton());
    await doneHeading();
    sent.push(...realBatches(imports));
    cleanup();

    // No Hevy id is sent for real twice.
    const ids = sent.flatMap((b) => b.workouts.map((w) => w.hevyWorkoutId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(125);

    // Run 3: nothing left.
    imports.reset();
    setupImportRun(auth, { workouts, sharedImports: imports });
    await toSummary();
    expect(screen.getByText("Nothing new to import")).toBeInTheDocument();
    expect(counts().getByText("125 already in SIN")).toBeInTheDocument();
  });
});
