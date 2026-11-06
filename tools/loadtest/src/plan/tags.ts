/** Spec 16 AC11 — every request is tagged with a route template, never a URL with an id in it. */
export const TAG_KEYS = ["name", "step", "phase", "target"] as const;
export type TagKey = (typeof TAG_KEYS)[number];

const ID = "[0-9a-fA-F-]{36}";

const ROUTES: readonly [method: string, pattern: RegExp, name: string][] = [
  ["GET", /^\/v1\/me$/, "me"],
  ["GET", /^\/v1\/exercises$/, "exercises"],
  ["GET", /^\/v1\/muscle-groups$/, "muscle_groups"],
  ["GET", /^\/v1\/equipment$/, "equipment"],
  ["GET", /^\/v1\/routines$/, "routines"],
  ["GET", /^\/v1\/workouts\/active$/, "workout_active"],
  ["GET", /^\/v1\/personal-records$/, "personal_records"],
  ["POST", /^\/v1\/workouts$/, "workout_start"],
  ["POST", new RegExp(`^/v1/workout-exercises/${ID}/sets$`), "set_save"],
  ["PATCH", new RegExp(`^/v1/workouts/${ID}$`), "workout_finish"],
  ["GET", /^\/v1\/workouts$/, "history"],
  ["GET", new RegExp(`^/v1/progress/exercises/${ID}$`), "progress"],
  ["GET", /^\/healthz$/, "warmup_healthz"],
];

/** The tag `name` for a request; throws on a path with no template, so no untagged URL ever reaches k6. */
export function routeName(method: string, path: string): string {
  const bare = path.split("?")[0]!;
  const hit = ROUTES.find(([m, re]) => m === method && re.test(bare));
  if (!hit) throw new Error(`no route template for ${method} ${bare}`);
  return hit[2];
}
