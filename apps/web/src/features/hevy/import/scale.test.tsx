import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

import type { HevyImportBatch, HevyImportOutcome } from "@sin/core";

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

describe("20.1 AC27 — scale", () => {
  it(
    "reads, summarizes and imports 1,500 workouts: ≤ 25 per request, ≤ 50 list rows per group, one status change per batch",
    async () => {
      const workouts = generateHevyWorkouts(1500, 7);
      const at = (i: number) => workouts[i]!.id;
      // Every outcome sprinkled in.
      const forced = new Map<string, HevyImportOutcome>();
      for (let i = 3; i < 1500; i += 97) forced.set(at(i), "rejected");
      for (let i = 5; i < 1500; i += 131) forced.set(at(i), "no_usable_sets");
      for (let i = 7; i < 1500; i += 173) forced.set(at(i), "time_invalid");
      const links = [
        ...Array.from({ length: 60 }, (_, k) => ({ hevyWorkoutId: at(11 + k * 20), origin: "imported" as const })),
        { hevyWorkoutId: at(13), origin: "sent" as const },
        { hevyWorkoutId: at(17), origin: "deleted" as const },
        { hevyWorkoutId: at(19), origin: "matched" as const },
      ];
      const duplicateOf = new Map(Array.from({ length: 120 }, (_, k) => [at(1 + k * 12), `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`]));
      const { imports } = setupImportRun(auth, {
        workouts,
        imports: {
          links,
          duplicateOf,
          outcomeFor: (id) => forced.get(id),
          dropsFor: (id) => (id.endsWith("0") ? [{ code: "set_out_of_range", count: 1 }] : []),
          delayMs: 1,
        },
      });
      const { user } = await toSummary();

      // Every group, opened, draws at most 50 rows until Show 50 more.
      for (const group of screen.getAllByRole("group")) {
        const details = group.closest("details")!;
        await user.click(within(details).getByText(/\(/, { selector: "summary" }));
        expect(within(details).getAllByRole("listitem").length).toBeLessThanOrEqual(50);
      }

      await user.click(importButton());
      const region = await waitFor(() => screen.getByText(/^Importing…/).closest("[role=status]") as HTMLElement);
      const seen = [region.textContent ?? ""];
      const observer = new MutationObserver(() => {
        const text = region.textContent ?? "";
        if (text !== seen[seen.length - 1]) seen.push(text);
      });
      observer.observe(region, { subtree: true, childList: true, characterData: true });
      await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 25_000 });
      observer.disconnect();

      const all = imports.log.filter((r) => r.path === "/v1/hevy/import/workouts").map((r) => r.body as HevyImportBatch);
      expect(Math.max(...all.map((b) => b.workouts.length))).toBeLessThanOrEqual(25);
      const sent = realBatches(imports);
      expect(sent.length).toBe(Math.ceil(sent.reduce((n, b) => n + b.workouts.length, 0) / 25));
      // The line changes per batch, never per workout: every count shown is a batch boundary, and there are never more
      // lines than batches (two replies landing in one render may share one; the last lands with the finish step).
      const lines = seen.filter((t) => t !== "");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.length).toBeLessThanOrEqual(sent.length);
      for (const line of lines) expect(Number(/Importing… ([\d,]+) of/.exec(line)![1]!.replace(/,/g, "")) % 25).toBe(0);
    },
    30_000,
  );
});
