import { Link } from "react-router";

/**
 * Shown on a public route while the session-resume bridge kicks off a login
 * redirect (Spec 04.0 §5 / §6.8, AC4). Transient, no interactive controls
 * beyond a manual escape hatch: if the redirect never completes (a stale Auth0
 * hint cookie with no live SSO session, or the user keeps cancelling Universal
 * Login), "Go to sign in" breaks the loop by landing on `<Landing/>` via the
 * `?signin` param `PublicEntry` honours. Unstyled; CSS-Modules tokens are Spec
 * 04.1.
 */
export function ResumingSession() {
  return (
    <main data-testid="resuming-session" role="status" aria-live="polite">
      <p>Resuming your session…</p>
      <Link to="/?signin">Go to sign in</Link>
    </main>
  );
}
