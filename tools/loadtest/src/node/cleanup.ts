import type { Api } from "./api.ts";

/**
 * Spec 16 AC15 — remove every workout of one load-test account through the API: the live one, then each page of
 * history. A `404` on delete counts as done (a repeat, or someone else removed it). The seeded routine stays.
 * Returns how many workouts were removed.
 */
export async function cleanupAccount(api: Api): Promise<number> {
  let removed = 0;
  const remove = async (id: string) => {
    const { status } = await api.del(`/v1/workouts/${id}`);
    if (status !== 204 && status !== 200 && status !== 404) throw new Error(`DELETE /v1/workouts/{id} answered ${status}`);
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
    removed += await cleanupAccount(api);
  }
  return { removed };
}
