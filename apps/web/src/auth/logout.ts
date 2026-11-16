import type { Auth0ContextInterface } from "@auth0/auth0-react";

import { clearUserData, isOutboxFile, LEGACY_OUTBOX_FILE, OUTBOX_FILE_PREFIX } from "../storage/clearUserData";
import { blockUserDataWrites, localStorageAdapter, type StorageAdapter } from "../storage/storage";

export type Auth0Logout = Auth0ContextInterface["logout"];

/**
 * Spec 06.7 AC9, §6.8. `forced` (a lost session, `useApi`'s `onAuthLost`) keeps every account's unsent workout file,
 * so the same lifter signing back in sends it. `deliberate` (`useSession().logout`) clears the signed-in user's file
 * and keeps other people's (owner O1). No mode clears every outbox file, as before.
 */
export type LogoutMode = { kind: "forced" } | { kind: "deliberate"; userId: string };

function keepFor(mode: LogoutMode | undefined): ((key: string) => boolean) | undefined {
  if (mode === undefined) return undefined;
  // A legacy file is kept too: a session lost before the outbox loaded (and adopted it) must not lose its sets.
  if (mode.kind === "forced") return (key) => key === LEGACY_OUTBOX_FILE || isOutboxFile(key);
  const own = `${OUTBOX_FILE_PREFIX}${mode.userId}`;
  return (key) => isOutboxFile(key) && key !== own;
}

/**
 * The one logout path (Spec 06.0 §6.7, AC20). Stops further user-data writes
 * (Spec 06.1 AC13), clears every user-scoped storage key, then hands off to
 * Auth0. Clearing comes first because the Auth0 redirect unloads the page.
 * Every caller that ends a session goes through here — a test fails if another
 * file builds `logoutParams`.
 */
export function logoutAndClear(
  auth0Logout: Auth0Logout,
  storage: StorageAdapter = localStorageAdapter(),
  mode?: LogoutMode,
): void {
  blockUserDataWrites();
  clearUserData(storage, { keep: keepFor(mode) });
  void auth0Logout({ logoutParams: { returnTo: window.location.origin } });
}
