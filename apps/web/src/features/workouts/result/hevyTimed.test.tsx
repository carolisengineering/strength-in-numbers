import { cleanup, screen, within } from "@testing-library/react";
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
vi.mock("../../../observability/reportError", () => ({ reportError: vi.fn() }));

import type { HevyMapping, HevyPair } from "@sin/core";
import { cleanupSendScreen, setupSendScreen, WORKOUT_ID } from "../../../test/hevySendHarness";
import { sendFixture } from "../../../test/hevySendFakes";
import { renderApp } from "../../../test/workoutHarness";

afterEach(() => {
  cleanup();
  cleanupSendScreen();
});

const raw = (glob: Record<string, unknown>) => glob as Record<string, string>;
const web = raw(import.meta.glob(["../../../**/*.ts", "../../../**/*.tsx", "!../../../**/*.test.ts", "!../../../**/*.test.tsx", "!../../../test/**"], { query: "?raw", import: "default", eager: true }));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("10.7 AC62 — Hevy needs no new UI", () => {
  it("sending a finished workout with a timed Set Timer section puts the duration and the timer line on the workout placeholder", async () => {
    const base = sendFixture();
    const detail = sendFixture({
      sections: [{ name: "Main", timer: { format: "set_timer", roundSeconds: 300, rounds: 5 }, roundTimes: [{ round: 1, seconds: 221 }, { round: 2, seconds: 218 }] }],
      exercises: base.detail.exercises.map((e, i) => ({ exerciseId: e.exerciseId, name: e.exerciseNameSnapshot, modality: e.modalitySnapshot, sectionIndex: i === 0 ? 0 : null, sets: e.sets })),
    }).detail;
    const workPair: HevyPair = { hevyTemplateId: "T-WORK", hevyTitle: "Workout", hevyType: "duration", role: "workout_placeholder", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false };
    const mapping: HevyMapping = { ...base.mapping, pairs: [...base.mapping.pairs, workPair] };
    const s = setupSendScreen(auth, { detail, mapping });
    const { user } = renderApp(`/app/history/${WORKOUT_ID}`);
    await user.click(await screen.findByRole("button", { name: "Send to Hevy" }));
    expect(await within(await screen.findByRole("region", { name: "Hevy" })).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    const create = s.hevy.writes()[0] as { body: { workout: { exercises: { exercise_template_id: string; notes: string | null; sets: { duration_seconds?: number | null }[] }[] } } };
    const marker = create.body.workout.exercises.find((e) => e.exercise_template_id === "T-WORK")!;
    expect(marker.sets[0]!.duration_seconds).toBe(439);
    expect(marker.notes).toContain("Set Timer 5 × 5:00 · 3:41, 3:38 · total 7:19");
  });

  it("no web module builds the Hevy body or a timer line outside features/hevy and @sin/core", () => {
    expect(Object.keys(web).length).toBeGreaterThan(100);
    // Glob keys are relative to this file: features/hevy/ reads as "../../hevy/…".
    const builders = Object.entries(web).filter(([p, src]) => !/^\.\.\/\.\.\/hevy\//.test(p) && /\bbuildHevyWorkout\(/.test(stripComments(src))).map(([p]) => p);
    expect(Object.keys(web).some((p) => /^\.\.\/\.\.\/hevy\/send\/runSend\.ts$/.test(p))).toBe(true);
    expect(builders).toEqual([]);
    const timerLines = Object.entries(web).filter(([, src]) => stripComments(src).includes(" · total ")).map(([p]) => p);
    expect(timerLines).toEqual([]);
  });
});
