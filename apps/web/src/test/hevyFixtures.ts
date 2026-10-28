import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test-only: Hevy's replies, read from the fixtures Spec 19.0 AC3 copied from Hevy's OpenAPI examples, so the web
 * and core tests parse the same bytes.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/core/test/fixtures/hevy");
const read = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

export const hevyFixtures = {
  userInfo: () => read("user-info.json"),
  templatesPage: () => read("templates-page.json"),
  workoutsPage: () => read("workouts-page.json"),
  routinesPage: () => read("routines-page.json"),
  foldersPage: () => read("folders-page.json"),
  createWorkoutReply: () => read("post-workout-reply.json"),
  updateWorkoutReply: () => read("put-workout-reply.json"),
};

/** A reply `fetch` resolves with. */
export const jsonReply = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...init.headers } });
