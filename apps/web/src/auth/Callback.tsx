import { useAuth0 } from "@auth0/auth0-react";
import { Navigate, useSearchParams } from "react-router";

import { AuthError } from "../screens/AuthError";
import { Spinner } from "../screens/Spinner";

/**
 * `/callback` (Spec 04.0 §5, AC6). `@auth0/auth0-react` runs the PKCE code
 * exchange on provider mount and then fires `onRedirectCallback`, which
 * navigates away to a clean path (`makeOnRedirectCallback` in `app/router`).
 *
 * This element only covers what happens while that is in flight or when it
 * fails:
 * - `useAuth0().error` or an Auth0 `?error=` param → `<AuthError/>`.
 * - exchange in flight (`isLoading`, or a `?code=` still on the URL) → spinner.
 * - neither (a direct visit with nothing to exchange) → bounce to `/`.
 */
export function Callback() {
  const { isLoading, error } = useAuth0();
  const [params] = useSearchParams();
  const errorParam = params.get("error");

  if (error || errorParam) {
    const description =
      error instanceof Error
        ? error.message
        : (params.get("error_description") ?? undefined);
    return <AuthError description={description} />;
  }

  if (isLoading || params.has("code")) {
    return <Spinner label="Signing you in…" />;
  }

  return <Navigate to="/" replace />;
}
