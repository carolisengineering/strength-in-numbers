import type { RedirectLoginOptions } from "@auth0/auth0-react";

import { getConfig } from "../config";
import { authRedirectUri } from "./Auth0ProviderWithNavigate";

export type LoginWithRedirect = (
  options?: RedirectLoginOptions,
) => Promise<void>;

/**
 * Shared login trigger (Spec 04.0 §5 / §6.8, AC5). `Landing` (the "Log in"
 * button) and `PublicEntry` (the session-resume bridge) both call this, so the
 * PKCE parameters — `audience`, the `/callback` `redirect_uri`, and a `scope`
 * that includes `offline_access` — are set in exactly one place and AC5 can
 * assert the `loginWithRedirect` spy args directly.
 */
export function login(
  loginWithRedirect: LoginWithRedirect,
  returnTo = "/app",
): void {
  const { VITE_AUTH0_AUDIENCE } = getConfig();
  void loginWithRedirect({
    appState: { returnTo },
    authorizationParams: {
      audience: VITE_AUTH0_AUDIENCE,
      redirect_uri: authRedirectUri(),
      scope: "openid profile email offline_access",
    },
  });
}
