import type { QueryClient } from "@tanstack/react-query";

import { SESSION_EXPIRED_TITLE } from "../../api/client";
import { ApiError } from "../../api/problem";
import { ME_QUERY_KEY } from "../me/useMe";

export const isAccountDeleted = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.type === "account-deleted";

/**
 * Spec 12 AC10 — the client's `onAuthLost` has already started the logout, so show no notice: either a
 * second `401`, or a lost-session token failure (status 0, not a network error, titled "Session expired"
 * by `createApiClient`'s token step).
 */
export const isSessionEnded = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.status === 401 ||
    (error.status === 0 && !error.isNetworkError && error.title === SESSION_EXPIRED_TITLE));

/**
 * Spec 12 D7 — a `403 account-deleted` from an account call means "already done". Nothing else in the
 * app recognizes it except `ProtectedLayout`'s branch on the `me` query, so invalidate that query: its
 * refetch is the same 403 and the layout renders `AccountDeleted`. Returns the refetch, so the export
 * mutation's `onError` can hold the mutation pending until the `me` query has answered (BL-17).
 */
export async function notifyIfAccountDeleted(error: unknown, queryClient: QueryClient): Promise<void> {
  if (isAccountDeleted(error)) await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
}

/**
 * True once the `me` refetch has taken the screen out of this hook's hands (BL-17): it failed with
 * `403 account-deleted` (the layout swaps to `AccountDeleted`) or ended the session (`onAuthLost` is
 * logging out, AC10). Assumes `me` has an active observer (`ProtectedLayout` always has one): without
 * one the invalidation only marks it stale, nothing refetches, and this stays false.
 */
export function meTookOver(queryClient: QueryClient): boolean {
  const error = queryClient.getQueryState(ME_QUERY_KEY)?.error;
  return isAccountDeleted(error) || isSessionEnded(error);
}
