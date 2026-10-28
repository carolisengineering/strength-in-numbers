import type { HevyTemplate } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRef } from "react";

import { listAll } from "../client/listAll";
import { HEVY_KEYS } from "../keys";
import { useHevyClient } from "../useHevyClient";

/**
 * Spec 20.0 AC19: every Hevy exercise template, read page by page with the key. In memory only (no storage), kept
 * 10 minutes, removed on every key save or remove; a page that fails after its retries fails the whole read.
 */
export function useHevyTemplates(opts: { onPage?: (p: { page: number; pageCount: number }) => void } = {}): UseQueryResult<HevyTemplate[]> {
  const client = useHevyClient();
  // In a ref, so a new callback each render does not change the query.
  const onPage = useRef(opts.onPage);
  onPage.current = opts.onPage;
  return useQuery({
    queryKey: HEVY_KEYS.templates,
    queryFn: async ({ signal }) => {
      const out = await listAll((page, s) => client!.listTemplates(page, s), { signal, onPage: (p) => onPage.current?.(p) });
      if (out.error !== null) throw out.error;
      return out.pages.flatMap((p) => p.exercise_templates);
    },
    enabled: client !== null,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}
