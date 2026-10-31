import type { HevyTemplate } from "@sin/core";
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";

import type { HevyClient } from "../client/hevyClient";
import { listAll } from "../client/listAll";
import { HEVY_KEYS } from "../keys";
import { useHevyClient } from "../useHevyClient";
import { beginTemplatesRead, endTemplatesRead, reportTemplatesPage } from "./templatesProgress";

/**
 * Spec 20.0 AC19: every Hevy exercise template, read page by page with the key. In memory only (no storage), kept
 * 10 minutes, removed on every key save or remove; a page that fails after its retries fails the whole read.
 *
 * Minor 191: the one template read, for the hook and for `queryClient.fetchQuery` (the load sheet), so both share
 * the cache and an in-flight read. Minor 197: progress goes to `templatesProgress`, which every reader watches (a
 * query's `meta` belongs to whoever started the fetch, so a reader that joined it never heard its pages).
 */
export function hevyTemplatesQuery(client: HevyClient) {
  return {
    queryKey: HEVY_KEYS.templates,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<HevyTemplate[]> => {
      const read = beginTemplatesRead();
      try {
        const out = await listAll((page, s) => client.listTemplates(page, s), { signal, onPage: (p) => reportTemplatesPage(read, p) });
        if (out.error !== null) throw out.error;
        return out.pages.flatMap((p) => p.exercise_templates);
      } finally {
        endTemplatesRead(read);
      }
    },
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  } as const;
}

/**
 * Minors 231, 245: the template read for a reader that may cancel it. `owner.current` is true only while a fetch this
 * call started is in flight: a running read is joined and never owned (canceling it would strand its other reader),
 * a fresh cache answers at once, and a stale one refetches and is owned. A reader cancels only while it owns the read.
 */
export async function fetchHevyTemplates(queryClient: QueryClient, client: HevyClient, owner: { current: boolean }): Promise<HevyTemplate[]> {
  owner.current = queryClient.isFetching({ queryKey: HEVY_KEYS.templates }) === 0;
  try {
    return await queryClient.fetchQuery(hevyTemplatesQuery(client));
  } finally {
    owner.current = false;
  }
}

export function useHevyTemplates(): UseQueryResult<HevyTemplate[]> {
  const client = useHevyClient();
  return useQuery({ ...hevyTemplatesQuery(client!), enabled: client !== null });
}
