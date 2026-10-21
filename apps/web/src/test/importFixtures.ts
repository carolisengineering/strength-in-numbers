import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildImportPlan, readWorkoutText, type Exercise, type ImportPlan } from "@sin/core";
import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

import { READ_BUTTON, TEXT_LABEL } from "../features/routines/import/messages";

import { exerciseId, makeExercise } from "./catalogFixtures";

/** Spec 10.4 AC18's committed paste: the five screenshots of the design brief (the core test fixture). */
export const HIRAYA_TEXT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/core/test/fixtures/hiraya-2026-10-19.txt"),
  "utf8",
);

const BUILT_INS: ReadonlyArray<[string, Exercise["modality"]]> = [
  ["Barbell back squat", "weight_reps"],
  ["Barbell bench press", "weight_reps"],
  ["Conventional deadlift", "weight_reps"],
  ["Overhead press", "weight_reps"],
  ["Barbell row", "weight_reps"],
  ["Dumbbell lunge", "weight_reps"],
  ["Pull-up", "bodyweight_reps"],
  ["Weighted dip", "weighted_bodyweight"],
  ["Plank", "duration"],
  ["Treadmill run", "distance_duration"],
];

/** The ten built-ins (ids 1–10) plus a "Power Clean" (id 15), so the example has exact, similar and new cards. */
export const importCatalog: readonly Exercise[] = [
  ...BUILT_INS.map(([name, modality], i) =>
    makeExercise({ id: exerciseId(i + 1), name, modality, primaryMuscleId: null, equipmentId: null }),
  ),
  makeExercise({ id: exerciseId(15), name: "Power Clean", modality: "weight_reps", primaryMuscleId: null, equipmentId: null }),
];

/** Every pathname the router passes through (a redirect's target included), for asserting a navigation happened. */
export function trackPaths(router: { subscribe: (fn: (state: { location: { pathname: string } }) => void) => unknown }): string[] {
  const seen: string[] = [];
  router.subscribe((state) => seen.push(state.location.pathname));
  return seen;
}

/** On the paste screen: paste the example and Read workout. */
export async function readHiraya(user: UserEvent, text: string = HIRAYA_TEXT): Promise<void> {
  await user.click(await screen.findByLabelText(TEXT_LABEL));
  await user.paste(text);
  await user.click(screen.getByRole("button", { name: READ_BUTTON }));
}

/** A name card on the Check screen, by its written name (the fieldset's legend). */
export function cardGroup(written: string): Promise<HTMLElement> {
  return screen.findByRole("group", { name: written });
}

/** The name cards on screen, in order. */
export function cardGroups(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("fieldset[data-card]")];
}

/** A seeded PRNG (mulberry32), copied from `packages/core/test/helpers/history-generator.ts` (the web cannot import core's test helpers). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANDOM_LINES = [
  "Strength", "Accessory", "Conditioning", "Warmup", "Engine Block", "21-15-9", "10-8-6-4", "3 Sets:", "2 Rounds", "Directly into:",
  "- 10 Curl", "- 8-12 Goblet Squat", "10/10 Lunge", "Power Clean", "Push Press", "400 Meter Run", "Set 1: 5 Reps", "Set 2: 3 Reps @ 80%",
  "A note about pacing.", "Rest as needed.", "Front Raise", "Row",
];

/** Spec 10.4 property tests: a seeded mix of headings, schemes, lead-ins, bullets and notes, read and planned. */
export function randomPlan(seed: number): ImportPlan {
  const rnd = prng(seed);
  const lines = Array.from({ length: 10 + Math.floor(rnd() * 40) }, () => RANDOM_LINES[Math.floor(rnd() * RANDOM_LINES.length)]!);
  return buildImportPlan(readWorkoutText([...lines, "x."].join("\n")), () => "weight_reps");
}
