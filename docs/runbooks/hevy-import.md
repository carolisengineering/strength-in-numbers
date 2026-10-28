# Runbook: the one-time Hevy import (Spec 19.1)

The import moves a lifter's Hevy history into SIN. It is owner-only: only accounts on `HEVY_ENABLED_USER_IDS` reach the routes; everyone else gets a `404`. The Hevy API key stays in the browser; the server never sees it. There is no migration and no release step.

## The order of an import

The web side (Spec 20.1) runs these steps. You only need them to understand or repair one.

1. **Mapping.** Every Hevy exercise template the history uses is paired (`PUT` / `PATCH /v1/hevy/mapping`, Spec 19.0). An unpaired workout answers `unpaired` and writes nothing. Pair it and send the batch again.
2. **Dry run.** Send every workout with `dryRun: true`, in batches of at most 25. Nothing is written, and the results are exactly what the real run will return.
3. **Real run.** Send the same batches with `dryRun: false`. Each workout is its own transaction. Re-sending any batch is always safe: a workout that is already imported answers `already_imported`.
4. **Finish.** Call `POST /v1/hevy/import/finish` once after the last batch. It rebuilds the lifter's personal records in one transaction and clears `records_stale`.

## Records stuck stale

A batch that creates workouts sets `hevy_account.records_stale = true` and does not recompute records. Until the finish runs, records and History's record counts leave out the imported workouts.

**Where it shows:** `GET /v1/hevy/status` returns `recordsStale: true`.

Use either fix:

- **From the app:** call `POST /v1/hevy/import/finish` (the UI does this whenever `recordsStale` is true on opening). Calling it twice is safe.
- **By hand:** use the exact `DATABASE_URL` from Render (runbook B4).

  ```bash
  DATABASE_URL='<url>' pnpm --filter @sin/api run records:rebuild --user <id>
  ```

  ```sql
  UPDATE hevy_account SET records_stale = false WHERE user_id = '<id>';
  ```

## Undo an import

Imported rows are the ones with `source = 'hevy'`. For one user, run the statements in this order:

```sql
-- Cascades to sections, exercises and sets, and sets the links' workout_id to NULL.
DELETE FROM workout WHERE user_id = '<id>' AND source = 'hevy';
DELETE FROM hevy_link WHERE user_id = '<id>' AND origin = 'imported';
-- Optional: also forget which SIN workouts were matched as duplicates.
DELETE FROM hevy_link WHERE user_id = '<id>' AND origin = 'matched';
```

Then rebuild that user's records:

```bash
DATABASE_URL='<url>' pnpm --filter @sin/api run records:rebuild --user <id>
```

The undo is not a release step. Code rollback is `git revert`: the routes add no table or column.

## Staging smoke (after Phase B deploys)

These steps run as the owner, whose account is on `HEVY_ENABLED_USER_IDS`, against `https://si-api-ft2f.onrender.com`:

1. Make a dry run of one fixture workout whose exercises are paired (`dryRun: true`). It returns `create` with `workoutId: null`.
2. Send the same workout as a real run (`dryRun: false`). It returns `create` with a `workoutId`.
3. Send it again. It returns `already_imported`.
4. `GET /v1/workouts/{workoutId}` returns it with `source: "hevy"`.
5. `DELETE /v1/workouts/{workoutId}` returns `204`.
6. `POST /v1/hevy/import/finish` returns `recomputed: true`, and a second call returns `recomputed: false`.

## Latency

`bench:hevy-import` is a local dev tool and needs Docker. It seeds 1,500 workouts, then imports 1,500 more in 60 batches and runs the finish. The first run (2026-10-28) gave:

| Measure | Result | Target |
|---|---|---|
| Batch p50 | 331 ms | — |
| Batch p95 | 389 ms | under 2 s |
| Finish | 589 ms | under 10 s |

If the finish ever passes 10 s, use the by-hand `records:rebuild --user` above.
