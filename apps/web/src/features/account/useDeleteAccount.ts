import { AccountDeletedResponseSchema, type AccountDeletedResponse } from "@sin/core";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";
import { notifyIfAccountDeleted } from "./accountDeleted";

export const ACCOUNT_DELETE_KEY = ["account", "delete"] as const;

export interface DeleteVariables {
  /** The profile's IANA zone, carried so the confirmation can format the erase date after the `me` cache is removed. */
  readonly timeZone: string;
}

export interface AccountDeletion {
  readonly response: AccountDeletedResponse;
  readonly timeZone: string;
}

/**
 * `DELETE /v1/account` (Spec 12 §6.5, AC18-AC20). `gcTime: Infinity` keeps the result in the mutation
 * cache after the Profile screen unmounts, so `ProtectedLayout` can keep showing the confirmation
 * (D3). Never `queryClient.clear()` anywhere near this: it empties the mutation cache too.
 */
export function useDeleteAccount() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<AccountDeletedResponse, Error, DeleteVariables>({
    mutationKey: ACCOUNT_DELETE_KEY,
    gcTime: Number.POSITIVE_INFINITY,
    networkMode: "always",
    mutationFn: () => api.delete("/v1/account", AccountDeletedResponseSchema),
    onError: (error) => notifyIfAccountDeleted(error, queryClient),
  });
}

/** The successful deletion, if any — read by `ProtectedLayout` above every provider. */
export function useAccountDeletion(): AccountDeletion | undefined {
  const found = useMutationState<AccountDeletion | undefined>({
    filters: { mutationKey: ACCOUNT_DELETE_KEY, status: "success" },
    select: (mutation) => {
      const response = mutation.state.data as AccountDeletedResponse | undefined;
      const variables = mutation.state.variables as DeleteVariables | undefined;
      return response && variables ? { response, timeZone: variables.timeZone } : undefined;
    },
  });
  return found.findLast((entry) => entry !== undefined);
}
