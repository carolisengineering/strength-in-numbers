import type { HevyTemplate } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRef } from "react";

import type { HevyClient } from "../client/hevyClient";
import { listAll } from "../client/listAll";
import { HEVY_KEYS } from "../keys";
import { useHevyClient } from "../useHevyClient";

/**
 * Spec 20.0 AC19: every Hevy exercise template, read page by page with the key. In memory only (no storage), kept
 * 10 minutes, removed on every key save or remove; a page that fails after its retries fails the whole read.
 */
type OnPage = (p: { page: number; pageCount: number }) => void;

/**
 * Minor 191: the one template read, for the hook and for `queryClient.fetchQuery` (the load sheet), so both share
 * the cache and an in-flight read. Progress goes to the `onPage` in the query's `meta`.
 */
export function hevyTemplatesQuery(client: HevyClient) {
  return {
    queryKey: HEVY_KEYS.templates,
    queryFn: async ({ signal, meta }: { signal: AbortSignal; meta?: Record<string, unknown> }): Promise<HevyTemplate[]> => {
      const onPage = meta?.onPage as OnPage | undefined;
      const out = await listAll((page, s) => client.listTemplates(page, s), { signal, onPage: (p) => onPage?.(p) });
      if (out.error !== null) throw out.error;
      return out.pages.flatMap((p) => p.exercise_templates);
    },
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  } as const;
}

export function useHevyTemplates(opts: { onPage?: (p: { page: number; pageCount: number }) => void } = {}): UseQueryResult<HevyTemplate[]> {
  const client = useHevyClient();
  // In a ref, so a new callback each render does not change the query.
  const onPage = useRef(opts.onPage);
  onPage.current = opts.onPage;
  return useQuery({
    ...hevyTemplatesQuery(client!),
    meta: { onPage: (p: { page: number; pageCount: number }) => onPage.current?.(p) },
    enabled: client !== null,
  });
}
