import { Link } from "react-router";

import { FrontDoor, frontDoorStyles } from "./FrontDoor";

/**
 * Shown on a public route while the session-resume bridge kicks off a login
 * redirect (Spec 04.0 §5 / §6.8, AC4; designed in Spec 17.3). Transient, no interactive controls
 * beyond a manual escape hatch: if the redirect never completes (a stale Auth0
 * hint cookie with no live SSO session, or the user keeps cancelling Universal
 * Login), "Go to sign in" breaks the loop by landing on `<Landing/>` via the
 * `?signin` param `PublicEntry` honours.
 *
 * The status role is on the sentence, not the `main` (17.3 AC15), so only "Resuming your session…" is announced.
 */
export function ResumingSession() {
  return (
    <FrontDoor testId="resuming-session">
      <p className={frontDoorStyles.line} role="status">
        Resuming your session…
      </p>
      <Link className={frontDoorStyles.control} to="/?signin">
        Go to sign in
      </Link>
    </FrontDoor>
  );
}
