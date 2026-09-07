import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useRef } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";

import { hasAuth0Session } from "../auth/authHint";
import { login } from "../auth/login";
import { Landing } from "../screens/Landing";
import { ResumingSession } from "../screens/ResumingSession";

function returnToOf(state: unknown): string {
  if (
    typeof state === "object" &&
    state !== null &&
    typeof (state as { returnTo?: unknown }).returnTo === "string"
  ) {
    return (state as { returnTo: string }).returnTo;
  }
  return "/app";
}

/**
 * The `/` element (Spec 04.0 §5 / §6.8, AC3 / AC4).
 *
 * - live session → straight to `/app`.
 * - no session but the Auth0 hint cookie is present → `<ResumingSession/>` and
 *   an immediate `loginWithRedirect`, carrying `returnTo` (from router state on
 *   a deep unauth entry) so the round-trip lands back where the user started.
 * - no session, no cookie → `<Landing/>`; no redirect, no `/v1` call.
 *
 * `?signin` escape hatch: the Auth0 hint cookie (`auth0.{clientId}.is.authenticated`)
 * outlives the server-side SSO session and is only cleared on explicit logout, so
 * a stale cookie would otherwise trap the user in an auto-redirect loop when the
 * SSO session is gone (cancel at Universal Login → `<AuthError/>` → back to `/` →
 * redirect again). `AuthError` / `ResumingSession` send the user to `/?signin`,
 * which suppresses the auto-resume for that visit and shows `<Landing/>` with its
 * explicit "Log in" control.
 */
export function PublicEntry() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = returnToOf(location.state);

  const resumeSuppressed = searchParams.has("signin");
  const resuming =
    !isAuthenticated && !resumeSuppressed && hasAuth0Session();
  const redirected = useRef(false);

  useEffect(() => {
    if (resuming && !redirected.current) {
      redirected.current = true;
      login(loginWithRedirect, returnTo);
    }
  }, [resuming, returnTo, loginWithRedirect]);

  if (isAuthenticated) return <Navigate to="/app" replace />;
  if (resuming) return <ResumingSession />;
  return <Landing />;
}
