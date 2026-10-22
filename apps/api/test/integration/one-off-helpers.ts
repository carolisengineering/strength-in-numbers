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

/** Every statement the db's client sends, through the `$on("query")` event (`routine-sections-reads` pattern).
 * One listener per db; the caller resets the array with `.length = 0` before the code it measures. */
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
