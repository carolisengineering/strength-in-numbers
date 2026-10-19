import { useNavigate } from "react-router";

import { Button } from "../ui/Button";
import styles from "./AuthError.module.css";
import { FrontDoor, frontDoorStyles } from "./FrontDoor";

export interface AuthErrorProps {
  /** Auth0-provided `error_description` — shown verbatim when present. */
  description?: string;
}

/**
 * "Couldn't sign you in" terminal screen (Spec 04.0 §5, AC6; on the front door since BL-20). Rendered by
 * `Callback` on a `useAuth0().error` or an Auth0 `?error=` redirect param. The name is decorative here, so the
 * screen's heading is the error itself.
 * "Try again" returns to `/?signin` — the Auth0 hint cookie is NOT cleared by a
 * failed login (only by explicit logout), so a bare `/` would re-trigger the
 * resume redirect and loop; `?signin` suppresses that and yields `<Landing/>`.
 */
export function AuthError({ description }: AuthErrorProps) {
  const navigate = useNavigate();

  return (
    <FrontDoor testId="auth-error" decorativeName>
      <div className={`${frontDoorStyles.line} ${styles.lines}`}>
        <h1 className={styles.heading}>Couldn&apos;t sign you in.</h1>
        <span>Your workouts are safe.</span>
        {description ? (
          <p className={styles.detail} data-testid="auth-error-detail">
            Details: {description}
          </p>
        ) : null}
      </div>
      <Button block className={frontDoorStyles.login} onClick={() => void navigate("/?signin")}>
        Try again
      </Button>
    </FrontDoor>
  );
}
