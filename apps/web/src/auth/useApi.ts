import { useAuth0 } from "@auth0/auth0-react";
import { useMemo } from "react";

import { createApiClient, type ApiClient } from "../api/client";
import { getConfig } from "../config";

/**
 * Binds the React-free `createApiClient` (Spec 04.0 §6.4) to Auth0 (§6; feeds
 * AC9 / AC12).
 *
 * - `baseUrl` / `appEnv` come from validated config.
 * - `getToken` maps the client's `{ ignoreCache: true }` to
 *   `@auth0/auth0-react` v2's `getAccessTokenSilently({ cacheMode: "off" })`.
 *   A `missing_refresh_token` rejection propagates and the client routes it to
 *   `onAuthLost`.
 * - `onAuthLost` triggers a full Auth0 logout back to this origin.
 *
 * The client is memoised on `getAccessTokenSilently` / `logout`.
 * `Auth0Provider` wraps both in `useCallback(fn, [client])`, and `client` is a
 * once-created `useState` initializer (`@auth0/auth0-react@2.24.1`
 * `dist/auth0-react.esm.js` L308 / L446 / L483), so both refs are render-stable
 * and this memo yields one `ApiClient` for the provider's lifetime — which is
 * what keeps the `useMe` `queryFn` stable (AC9).
 */
export function useApi(): ApiClient {
  const { getAccessTokenSilently, logout } = useAuth0();

  return useMemo<ApiClient>(() => {
    const config = getConfig();
    return createApiClient({
      baseUrl: config.VITE_API_BASE_URL,
      appEnv: config.VITE_APP_ENV,
      getToken: (options) =>
        options?.ignoreCache
          ? getAccessTokenSilently({ cacheMode: "off" })
          : getAccessTokenSilently(),
      onAuthLost: () => {
        void logout({ logoutParams: { returnTo: window.location.origin } });
      },
    });
  }, [getAccessTokenSilently, logout]);
}
