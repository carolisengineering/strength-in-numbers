import { useMemo } from "react";

import { useCatalogStore } from "../../catalog/CatalogProvider";
import { visibleRows } from "../../catalog/visibility";
import { useMappingMutations } from "../mapping/useMappingMutations";
import { sleep } from "../sharedClient";
import type { SavePairingsDeps } from "./savePairings";

/**
 * Minor 187: what `savePairings` needs, from the catalog store and the mapping writes. The patch goes through
 * `useMappingMutations`, so its reply is written into `["hevy","mapping"]` and the status is re-read (AC28). The
 * store's `refresh` never rejects, so a refresh that leaves the store in error rejects here: a retry must not reuse a
 * stale list.
 */
export function useSavePairingsDeps(): SavePairingsDeps {
  const store = useCatalogStore();
  const { patch } = useMappingMutations();
  const patchMapping = patch.mutateAsync;
  return useMemo(
    () => ({
      createCustom: (input) => store.createCustom(input),
      refresh: async (force) => {
        await store.refresh(force);
        if (store.getState().status === "error") throw new Error("catalog refresh failed");
      },
      visibleRows: () => visibleRows(store.getState().rows),
      patchMapping: (body) => patchMapping(body),
      sleep,
      now: () => Date.now(),
    }),
    [store, patchMapping],
  );
}
