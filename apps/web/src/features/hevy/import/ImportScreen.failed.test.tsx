import { cleanup, screen } from "@testing-library/react";
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

// Minor 250: no I/O path throws today, so the throw is planted in the run or the finish.
const plant = vi.hoisted(() => ({ run: false, finish: false, routines: false, reported: [] as unknown[][] }));
vi.mock("../../../observability/reportError", () => ({ reportError: (...args: unknown[]) => void plant.reported.push(args) }));
vi.mock("./runImport", async (original) => {
  const real = await original<typeof import("./runImport")>();
  return {
    ...real,
    runImport: (...args: Parameters<typeof real.runImport>) => {
      if (plant.run) {
        plant.run = false;
        return Promise.reject(new Error("planted"));
      }
      return real.runImport(...args);
    },
  };
});
vi.mock("./finishImport", async (original) => {
  const real = await original<typeof import("./finishImport")>();
  return {
    ...real,
    finishImport: (...args: Parameters<typeof real.finishImport>) => {
      if (plant.finish) {
        plant.finish = false;
        return Promise.reject(new Error("planted"));
      }
      return real.finishImport(...args);
    },
  };
});

vi.mock("./createRoutines", async (original) => {
  const real = await original<typeof import("./createRoutines")>();
  return {
    ...real,
    createRoutines: (...args: Parameters<typeof real.createRoutines>) => (plant.routines ? Promise.reject(new Error("planted")) : real.createRoutines(...args)),
  };
});

import type { HevyRoutine } from "@sin/core";

import { setInstantPacing, USER_ID } from "../../../test/hevyHarness";
import { GENERATED_TEMPLATE_IDS, generateHevyWorkouts } from "../../../test/hevyImportFakes";
import { finishRequests, importButton, setupImportRun, toSummary } from "../../../test/hevyImportRun";
import { pinTimeZone } from "../../../test/timeZone";
import { cleanupApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
import { resetImportLaneForTests } from "./importLane";

pinTimeZone("UTC");
beforeEach(() => {
  setInstantPacing();
  plant.run = false;
  plant.finish = false;
  plant.routines = false;
  plant.reported = [];
});
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  resetImportLaneForTests();
  cleanupApp();
});

describe("minor 250 — a throw never leaves the import stuck", () => {
  it("a throw in the run is reported and stops with a sentence, Resume and Finish up; Resume runs to Done", async () => {
    setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const { user } = await toSummary();
    plant.run = true;
    await user.click(importButton());
    expect(await screen.findByRole("heading", { level: 2, name: "Stopped" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this screen.");
    expect(plant.reported).toEqual([[expect.any(Error), { source: "hevy-import", op: "run" }]]);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("a throw in the finish lands on Done with the finish failed; Try again finishes", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const { user } = await toSummary();
    plant.finish = true;
    await user.click(importButton());
    expect(await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText("Your workouts are in, but updating your records didn't finish.")).toBeInTheDocument();
    expect(plant.reported).toEqual([[expect.any(Error), { source: "hevy-import", op: "run" }]]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
    expect(finishRequests(imports)).toHaveLength(1);
  });

  it("a throw while creating routines lands on Done and says the routines may be missing", async () => {
    const pushA: HevyRoutine = { id: "r1", title: "Push A", folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[0], sets: [] }] };
    setupImportRun(auth, { workouts: generateHevyWorkouts(3), routines: [pushA] });
    const { user } = await toSummary({ tick: ["Push A"] });
    plant.routines = true;
    await user.click(importButton());
    expect(await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Something went wrong while creating routines. Check Routines; running the import again copies any that are missing.")).toBeInTheDocument();
    expect(await screen.findByText("Records updated.")).toBeInTheDocument();
  });

  it("a throw in Try again's finish keeps Try again offered", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(3) });
    const { user } = await toSummary();
    imports.failFinish([500]);
    await user.click(importButton());
    const tryAgain = await screen.findByRole("button", { name: "Try again" }, { timeout: 5000 });
    plant.finish = true;
    await user.click(tryAgain);
    await vi.waitFor(() => expect(plant.reported).toContainEqual([expect.any(Error), { source: "hevy-import", op: "run" }]));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByText("Your workouts are in, but updating your records didn't finish.")).toBeInTheDocument();
    expect(finishRequests(imports)).toHaveLength(1);
  });
});
