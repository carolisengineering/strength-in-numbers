import { MeSchema, type Me, type UpdateMeInput } from "@sin/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";
import { track } from "../../observability/track";
import { ME_QUERY_KEY } from "./useMe";

/**
 * `PATCH /v1/me` (Spec 04.1 §6.5, AC6). The body is only the changed fields
 * (the screen decides which); the `200` body is `MeSchema.parse`d by the client
 * and written **straight into the `["me"]` cache** with `setQueryData` — no
 * `invalidateQueries`, no refetch — so `AppShell`'s header re-renders
 * synchronously from the same query every other consumer reads.
 *
 * Errors are left to the caller: a `422` `ApiError` carries `errors[]` for the
 * per-field messages; anything else is a form-level message with `requestId`.
 */
export function useUpdateMe() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<Me, Error, UpdateMeInput>({
    mutationFn: (input) => api.patch("/v1/me", input, MeSchema),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_QUERY_KEY, me);
      track("profile_saved");
    },
  });
}
