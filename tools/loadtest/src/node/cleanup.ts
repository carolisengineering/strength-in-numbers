import type { Api } from "./api.ts";

/**
 * Spec 16 AC15 — remove every workout of one load-test account through the API: the live one, then each page of
 * history. A `404` on delete counts as done (a repeat, or someone else removed it). The seeded routine stays.
 * Returns how many workouts were removed.
 */
export async function cleanupAccount(api: Api): Promise<number> {
  let removed = 0;
  // Minor 364: every id this pass deleted, with what its DELETE answered. One that page one lists again was never
  // removed, so the loop below would read the same page forever.
  const deleted = new Map<string, number>();
  const remove = async (id: string) => {
    const { status } = await api.del(`/v1/workouts/${id}`);
    if (status !== 204 && status !== 200 && status !== 404) throw new Error(`DELETE /v1/workouts/{id} answered ${status}`);
    deleted.set(id, status);
    removed += 1;
  };

  const active = await api.get("/v1/workouts/active");
  if (active.status === 200) await remove((active.body as { id: string }).id);

  // Deleting shifts later pages, so keep reading the first page until it comes back empty.
  for (;;) {
    const page = await api.get("/v1/workouts?limit=50");
    if (page.status !== 200) throw new Error(`GET /v1/workouts answered ${page.status}`);
    const { items } = page.body as { items: { id: string }[]; next: string | null };
    if (items.length === 0) break;
    const stuck = items.find((w) => deleted.has(w.id));
    if (stuck) throw new Error(`a workout is still listed after its delete answered ${deleted.get(stuck.id)}`);
    for (const w of items) await remove(w.id);
  }
  return removed;
}

/**
 * Clean every account in the given list, one at a time, pacing between accounts (the CLI keeps the total under the
 * API's per-IP budget). Touches no account outside the list.
 */
export async function cleanupAll(apis: Api[], opts: { pace: (i: number) => Promise<void> }): Promise<{ removed: number }> {
  let removed = 0;
  for (const [i, api] of apis.entries()) {
    await opts.pace(i);
    try {
      removed += await cleanupAccount(api);
    } catch (err) {
      // By number only, as everywhere else in the tool.
      throw new Error(`account #${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { removed };
}
