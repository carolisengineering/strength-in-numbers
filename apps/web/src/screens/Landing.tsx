import { useAuth0 } from "@auth0/auth0-react";

import { login } from "../auth/login";

/**
 * Unauthenticated landing (Spec 04.0 §5, AC3). App name, a one-line value prop,
 * and exactly one control — "Log in" — wired to the shared `login()` helper
 * (Auth0 Universal Login covers sign-up too). No `/v1` call and no redirect on
 * mount. Unstyled; CSS-Modules tokens are Spec 04.1.
 */
export function Landing() {
  const { loginWithRedirect } = useAuth0();

  return (
    <main data-testid="landing">
      <h1>strength-in-numbers</h1>
      <p>Log your lifts. See the numbers move.</p>
      <button
        type="button"
        data-testid="landing-login"
        onClick={() => login(loginWithRedirect)}
      >
        Log in
      </button>
    </main>
  );
}
