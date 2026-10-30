import type { IntegrationDb } from "./helpers.js";

/** Spec 09.3 §10 — move a one-off's `created_at` and `one_off_until` back by `days` (so the CHECK holds and
 * no test sleeps). `days` > 14 makes an unexpired one-off expired. */
export async function ageOneOff(db: IntegrationDb, routineId: string, days: number): Promise<void> {
  await db.prisma.$executeRawUnsafe(
    `UPDATE "routine" SET created_at = created_at - make_interval(days => $2::int),
                          one_off_until = one_off_until - make_interval(days => $2::int)
     WHERE id = $1::uuid`,
    routineId,
    days,
  );
}

const captured = new WeakMap<IntegrationDb, string[]>();
let markers = 0;
const MARKER_WAIT_MS = 5000;

/**
 * Sends a marker statement and waits until its `query` event has been seen. Prisma delivers those events
 * asynchronously, so a statement's event can land after its promise resolves; once the marker's event is in, every
 * earlier statement's is too.
 */
async function awaitMarker(db: IntegrationDb, seen: string[]): Promise<string> {
  const tag = `sin:capture:${(markers += 1)}`;
  await db.prisma.$queryRawUnsafe(`SELECT '${tag}' AS marker`);
  const deadline = Date.now() + MARKER_WAIT_MS;
  while (!seen.some((s) => s.includes(tag))) {
    if (Date.now() > deadline) throw new Error(`capture marker ${tag} never arrived`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return tag;
}

/**
 * Starts a measurement: every statement event from the setup has arrived and been dropped, so only the measured
 * code's statements are counted (a setup event landing late made 09.3 AC30 count three statements on CI).
 */
export async function startCapture(db: IntegrationDb): Promise<string[]> {
  const seen = captureStatements(db);
  await awaitMarker(db, seen);
  seen.length = 0;
  return seen;
}

/** Ends a measurement: every statement event from the measured code has arrived; the marker itself is removed. */
export async function settleCapture(db: IntegrationDb, seen: string[]): Promise<void> {
  const tag = await awaitMarker(db, seen);
  seen.splice(seen.findIndex((s) => s.includes(tag)), 1);
}

/** Every statement the db's client sends, through the `$on("query")` event (`routine-sections-reads` pattern).
 * One listener per db. Measure with `startCapture` / `settleCapture`, not a bare `.length = 0`. */
export function captureStatements(db: IntegrationDb): string[] {
  const existing = captured.get(db);
  if (existing) return existing;
  const seen: string[] = [];
  (db.prisma as unknown as { $on: (e: "query", cb: (x: { query: string }) => void) => void }).$on("query", (e) =>
    seen.push(e.query),
  );
  captured.set(db, seen);
  return seen;
}
