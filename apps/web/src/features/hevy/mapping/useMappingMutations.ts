import { HevyMappingSchema, type HevyMapping, type HevyPair, type HevyPairInput, type HevySectionRule } from "@sin/core";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { ApiError } from "../../../api";
import { useApi } from "../../../auth/useApi";
import { HEVY_KEYS } from "../keys";
import { MAPPING_OFFLINE, MAPPING_REJECTED, MAPPING_SAVE_FAILED, mappingRateLimited } from "../messages";

/** A pair as written: the read shape minus `exerciseActive` (19.0 §5.3). */
export type PairInput = HevyPairInput;

export function toPairInput(pair: HevyPair): PairInput {
  const { exerciseActive: _active, ...input } = pair;
  void _active;
  return input;
}

export interface MappingMutations {
  put: UseMutationResult<HevyMapping, unknown, { pairs: PairInput[]; sectionRules: HevySectionRule[] }>;
  patch: UseMutationResult<HevyMapping, unknown, { upsert?: PairInput[]; remove?: string[] }>;
}

/**
 * Spec 20.0 AC22, AC25: the mapping writes. Pessimistic and online-only (`networkMode: "always"`, no retry): the
 * cache changes only from the server's response, and the status (its pair count) is re-read.
 */
export function useMappingMutations(): MappingMutations {
  const api = useApi();
  const queryClient = useQueryClient();
  const settle = (mapping: HevyMapping) => {
    queryClient.setQueryData(HEVY_KEYS.mapping, mapping);
    void queryClient.invalidateQueries({ queryKey: HEVY_KEYS.statusAll });
  };
  const put = useMutation({
    mutationFn: (body: { pairs: PairInput[]; sectionRules: HevySectionRule[] }) =>
      api.request<HevyMapping>("/v1/hevy/mapping", { method: "PUT", body, schema: HevyMappingSchema }),
    onSuccess: settle,
    networkMode: "always",
    retry: false,
  });
  const patch = useMutation({
    mutationFn: (body: { upsert?: PairInput[]; remove?: string[] }) =>
      api.request<HevyMapping>("/v1/hevy/mapping", { method: "PATCH", body, schema: HevyMappingSchema }),
    onSuccess: settle,
    networkMode: "always",
    retry: false,
  });
  return { put, patch };
}

/** A mapping write's failure, by kind; for `invalid` (a 422) the caller reads only `errors[0].path`. */
export function classifyMappingError(error: unknown): "offline" | "rate_limited" | "invalid" | "other" {
  if (!(error instanceof ApiError)) return "other";
  if (error.isNetworkError) return "offline";
  if (error.status === 429) return "rate_limited";
  if (error.status === 422) return "invalid";
  return "other";
}

/**
 * Minor 181, 193: the one sentence for a failed mapping write. A 429 says how long to wait; a 422 names only its
 * first field path (never a title); anything else is the caller's generic sentence.
 */
export function mappingErrorMessage(error: unknown, generic: string = MAPPING_SAVE_FAILED): string {
  const kind = classifyMappingError(error);
  if (kind === "offline") return MAPPING_OFFLINE;
  if (!(error instanceof ApiError)) return generic;
  if (kind === "rate_limited") return mappingRateLimited(error.retryAfterMs);
  if (kind === "invalid") {
    const path = error.errors[0]?.path;
    return path ? `${MAPPING_REJECTED} (${path})` : MAPPING_REJECTED;
  }
  return generic;
}
