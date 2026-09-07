import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router";

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
 */
export function PublicEntry() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const location = useLocation();
  const returnTo = returnToOf(location.state);

  const resuming = !isAuthenticated && hasAuth0Session();
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
