import type { QueryClient } from "@tanstack/react-query";

import { ApiError } from "../../api/problem";
import { ME_QUERY_KEY } from "../me/useMe";

export const isAccountDeleted = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.type === "account-deleted";

/** Spec 12 AC10 — a second `401` means the client's `onAuthLost` has already started the logout: show no notice. */
export const isSessionEnded = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

/**
 * Spec 12 D7 — a `403 account-deleted` from an account call means "already done". Nothing else in the
 * app recognizes it except `ProtectedLayout`'s branch on the `me` query, so invalidate that query: its
 * refetch is the same 403 and the layout renders `AccountDeleted`.
 */
export function notifyIfAccountDeleted(error: unknown, queryClient: QueryClient): void {
  if (isAccountDeleted(error)) void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
}
