import { useNavigate } from "react-router";

export interface AuthErrorProps {
  /** Auth0-provided `error_description` — shown verbatim when present. */
  description?: string;
}

/**
 * "Couldn't sign you in" terminal screen (Spec 04.0 §5, AC6). Rendered by
 * `Callback` on a `useAuth0().error` or an Auth0 `?error=` redirect param.
 * "Try again" returns to `/`, from which the (now cleared) hint cookie yields
 * `Landing`.
 */
export function AuthError({ description }: AuthErrorProps) {
  const navigate = useNavigate();

  return (
    <main data-testid="auth-error">
      <h1>Couldn&apos;t sign you in</h1>
      {description ? <p data-testid="auth-error-detail">{description}</p> : null}
      <button type="button" onClick={() => void navigate("/")}>
        Try again
      </button>
    </main>
  );
}
