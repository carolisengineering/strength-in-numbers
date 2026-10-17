import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";

import { login } from "../auth/login";
import { Button } from "../ui/Button";
import { FrontDoor, frontDoorStyles } from "./FrontDoor";

export interface LandingProps {
  /** Post-login destination (AC13); `PublicEntry` passes the captured deep path. */
  returnTo?: string;
}

/**
 * Unauthenticated landing (Spec 04.0 §5, AC3; designed in Spec 17.3). The front door's title card, two lines on
 * what the app does, and exactly one control, "Log in", wired to the shared `login()` helper (Auth0 Universal
 * Login covers sign-up too). No `/v1` call and no redirect on mount.
 *
 * `returnTo` is forwarded to `login()` so a deep unauthenticated entry
 * (`/app/x` → `ProtectedRoute` → `/` with `state.returnTo`) lands back on
 * `/app/x` after the PKCE round-trip, not on `/app` (AC13).
 *
 * One tap, one login (17.3 D9): a second `loginWithRedirect` would overwrite the first PKCE state, so the button
 * goes busy after the first tap. A back/forward-cache restore (Back from Universal Login) brings the page back
 * as it left, busy included, so a `pageshow` with `persisted` clears it.
 */
export function Landing({ returnTo }: LandingProps) {
  const { loginWithRedirect } = useAuth0();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const start = () => {
    // A second event can arrive before React re-renders the disabled button.
    if (busy) return;
    setBusy(true);
    login(loginWithRedirect, returnTo);
  };

  return (
    <FrontDoor testId="landing">
      <p className={frontDoorStyles.line}>
        <span>Log your lifts.</span> <span>Count your progress.</span>
      </p>
      <Button block busy={busy} className={frontDoorStyles.login} data-testid="landing-login" onClick={start}>
        Log in
      </Button>
    </FrontDoor>
  );
}
