/**
 * "A session resume already left from this page" (issue #14; Spec 04.0 §6.8).
 * Pure — no React — and takes the `History` as an argument so tests can pass a
 * fake.
 *
 * `PublicEntry` auto-resumes when the Auth0 hint cookie is present, but that
 * cookie outlives the SSO session. Without this, a raw browser Back from
 * Universal Login reloads bare `/` and resumes again, so the user can never
 * Back out past `/`. The flag lives in `history.state`, which belongs to one
 * session-history entry: it survives a Back to the entry, a reload of it and a
 * back/forward-cache restore, but a new tab or a freshly typed URL starts
 * unmarked, so a normal resume is unaffected. It is not browser storage (Spec
 * 04.0 AC7's scan).
 *
 * The key sits beside React Router's own `usr` / `key` / `idx`, not inside
 * them. It must be written *after* the router's last write to the entry: the
 * router keeps unknown keys when it initialises an entry on load (react-router
 * 7.18), but its own `replace` navigations write a fresh `{ usr, key, idx }`.
 * `PublicEntry` marks just before leaving, after `ProtectedRoute`'s
 * `<Navigate replace>` — nothing writes the entry after that. Pinned on the
 * real browser history by `router.test.tsx` (#14).
 */

const KEY = "sinResumeAttempted";

/** Mark the current entry. Synchronous, so it lands before `location.assign` unloads the page. */
export function markResumeAttempted(history: History = window.history): void {
  const state: unknown = history.state;
  const base = typeof state === "object" && state !== null ? state : {};
  history.replaceState({ ...base, [KEY]: true }, "");
}

export function resumeAttempted(history: History = window.history): boolean {
  const state: unknown = history.state;
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[KEY] === true;
}
