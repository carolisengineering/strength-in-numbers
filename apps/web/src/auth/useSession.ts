import { useAuth0 } from "@auth0/auth0-react";
import type { Me } from "@sin/core";
import { useCallback } from "react";
import { useLocation } from "react-router";

import { useMe } from "../features/me/useMe";
import { login as sharedLogin } from "./login";

export interface Session {
  /**
   * The `MeSchema`-typed body from the `["me"]` query. Defined on every
   * screen under `ProtectedLayout` (the gate holds the outlet closed until
   * `GET /v1/me` is `200`); `undefined` only on public routes.
   */
  readonly user: Me | undefined;
  readonly isAuthenticated: boolean;
  /** Start login, returning to the current path + search afterwards. */
  readonly login: () => void;
  /** Log out of Auth0 and land on the site origin. */
  readonly logout: () => void;
}

/**
 * Convenience hook for the current session (Spec 04.1 §6.3, AC4). Wraps
 * `useAuth0` + `useMe` so screens import one thing.
 *
 * `login()` **delegates to the shared 04.0 `login()` helper** rather than
 * calling `loginWithRedirect` directly: the helper is the one place that sets
 * `audience`, the `/callback` `redirect_uri`, and the `offline_access` scope.
 * A bare `loginWithRedirect({ appState })` would mint a token without the API
 * audience and every `/v1` call would then fail `401`.
 */
export function useSession(): Session {
  const { isAuthenticated, loginWithRedirect, logout: auth0Logout } = useAuth0();
  const { data: user } = useMe({ enabled: isAuthenticated });
  const { pathname, search } = useLocation();

  const login = useCallback(() => {
    sharedLogin(loginWithRedirect, `${pathname}${search}`);
  }, [loginWithRedirect, pathname, search]);

  const logout = useCallback(() => {
    void auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  }, [auth0Logout]);

  return { user, isAuthenticated, login, logout };
}
