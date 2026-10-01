import type { Auth0ContextInterface } from "@auth0/auth0-react";

import { clearUserData } from "../storage/clearUserData";
import { localStorageAdapter, type StorageAdapter } from "../storage/storage";

export type Auth0Logout = Auth0ContextInterface["logout"];

/**
 * The one logout path (Spec 06.0 §6.7, AC20). Clears every user-scoped
 * storage key, then hands off to Auth0. Clearing comes first because the
 * Auth0 redirect unloads the page. Every caller that ends a session goes
 * through here — a test fails if another file builds `logoutParams`.
 */
export function logoutAndClear(
  auth0Logout: Auth0Logout,
  storage: StorageAdapter = localStorageAdapter(),
): void {
  clearUserData(storage);
  void auth0Logout({ logoutParams: { returnTo: window.location.origin } });
}
