import { SEEDED_ROUTINE_KEYS, SEEDED_ROUTINE_NAME, seededRoutine, seededRoutineSets } from "../plan/routine.ts";
import type { Api } from "./api.ts";

/**
 * Spec 16 AC23 — give the account its routine once. Found by name, so a second run creates nothing. The catalog's
 * ids come from `GET /v1/exercises` by `catalogKey`.
 */
export async function ensureSeeded(api: Api): Promise<{ routineId: string; sets: number[] }> {
  const list = await api.get("/v1/routines");
  if (list.status !== 200) throw new Error(`GET /v1/routines answered ${list.status}`);
  const existing = (list.body as { routines: { id: string; name: string }[] }).routines.find((r) => r.name === SEEDED_ROUTINE_NAME);
  if (existing) return { routineId: existing.id, sets: seededRoutineSets() };

  const catalog = await api.get("/v1/exercises");
  if (catalog.status !== 200) throw new Error(`GET /v1/exercises answered ${catalog.status}`);
  const ids: Record<string, string> = {};
  for (const e of (catalog.body as { exercises: { id: string; catalogKey: string | null }[] }).exercises) {
    if (e.catalogKey !== null) ids[e.catalogKey] = e.id;
  }
  const missing = SEEDED_ROUTINE_KEYS.filter((k) => ids[k] === undefined);
  if (missing.length > 0) throw new Error(`the catalog has no ${missing.join(", ")} (run seed:catalog on the target)`);

  const created = await api.post("/v1/routines", seededRoutine(ids));
  if (created.status !== 201) throw new Error(`POST /v1/routines answered ${created.status}`);
  return { routineId: (created.body as { id: string }).id, sets: seededRoutineSets() };
}
