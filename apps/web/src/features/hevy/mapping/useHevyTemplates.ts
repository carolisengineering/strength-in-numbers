import type { HevyTemplate } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { HevyClient } from "../client/hevyClient";
import { listAll } from "../client/listAll";
import { HEVY_KEYS } from "../keys";
import { useHevyClient } from "../useHevyClient";
import { endTemplatesRead, reportTemplatesPage } from "./templatesProgress";

/**
 * Spec 20.0 AC19: every Hevy exercise template, read page by page with the key. In memory only (no storage), kept
 * 10 minutes, removed on every key save or remove; a page that fails after its retries fails the whole read.
 */

/**
 * Minor 191: the one template read, for the hook and for `queryClient.fetchQuery` (the load sheet), so both share
 * the cache and an in-flight read. Minor 197: progress goes to `templatesProgress`, which every reader watches (a
 * query's `meta` belongs to whoever started the fetch, so a reader that joined it never heard its pages).
 */
export function hevyTemplatesQuery(client: HevyClient) {
  return {
    queryKey: HEVY_KEYS.templates,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<HevyTemplate[]> => {
      reportTemplatesPage({ page: 1, pageCount: 1 });
      try {
        const out = await listAll((page, s) => client.listTemplates(page, s), { signal, onPage: reportTemplatesPage });
        if (out.error !== null) throw out.error;
        return out.pages.flatMap((p) => p.exercise_templates);
      } finally {
        endTemplatesRead();
      }
    },
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  } as const;
}

export function useHevyTemplates(): UseQueryResult<HevyTemplate[]> {
  const client = useHevyClient();
  return useQuery({ ...hevyTemplatesQuery(client!), enabled: client !== null });
}
