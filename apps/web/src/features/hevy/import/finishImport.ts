import type { HevyImportResult, HevyStatus } from "@sin/core";

import { reportError } from "../../../observability/reportError";
import type { HevyImportClient } from "./hevyImportClient";
import { importLane } from "./importLane";
import { reportable } from "./reportable";

/**
 * Spec 20.1 AC22, §6.8: the finish step, the only call that recomputes records. It queues on the lane, so it never
 * overlaps a batch. `recomputed: false` (another tab finished first, or nothing was stale) is still done. React-free.
 */
export async function finishImport(client: Pick<HevyImportClient, "finish">, signal?: AbortSignal): Promise<"ok" | "failed"> {
  try {
    await importLane.run(() => client.finish(signal));
    return "ok";
  } catch (err) {
    if (reportable(err)) reportError(err, { source: "hevy-import", op: "finish" });
    return "failed";
  }
}

/** AC22: a run that created no workout does not finish, unless the status already says the records are stale. */
export function needsFinish(runResults: readonly HevyImportResult[], status: Pick<HevyStatus, "recordsStale"> | undefined): boolean {
  return runResults.some((r) => r.outcome === "create") || status?.recordsStale === true;
}
