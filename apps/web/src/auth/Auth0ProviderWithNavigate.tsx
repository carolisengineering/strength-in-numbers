import {
  Auth0Provider,
  type AppState,
  type Auth0ProviderWithConfigOptions,
} from "@auth0/auth0-react";
import type { ReactNode } from "react";

import { getConfig, type Config } from "../config";

/**
 * Same-origin path to the self-hosted Auth0 refresh-token web worker
 * (Spec 04.0 §6.3 / Q17, AC8).
 *
 * With `cacheLocation: "memory"` + `useRefreshTokens`, `@auth0/auth0-spa-js`
 * isolates the refresh token in a Web Worker. Its default builds that worker
 * from a `blob:` URL, which a strict `script-src 'self'` / no-`blob:` CSP
 * blocks. The SDK also ships the worker as a standalone file; step 1's
 * `vite-plugin-static-copy` copies it to the `dist/` root at exactly this path,
 * and `@auth0/auth0-react` forwards `workerUrl` straight to `new Auth0Client()`
 * (Track C spike). Result: the worker loads under `script-src 'self'`.
 */
export const AUTH0_WORKER_URL = "/auth0-spa-js.worker.production.js";

/** The `/callback` URL Auth0 returns the one-time `code` to. */
export function authRedirectUri(): string {
  return `${window.location.origin}/callback`;
}

/**
 * The `Auth0Provider` configuration, from validated `VITE_*` config. Pure apart
 * from reading `window.location.origin`; kept separate from the component so
 * AC5 / AC7 / AC8 assert it without mounting React.
 *
 * - `cacheLocation: "memory"` — access AND refresh tokens live only in a JS
 *   closure / the worker; nothing in web storage or a readable cookie
 *   (Q12, AC7).
 * - `useRefreshTokens: true` + `useRefreshTokensFallback: false` — one
 *   deterministic cold-load path: refresh-token rotation, never a hidden
 *   `prompt=none` iframe (Q19).
 * - `scope` always includes `offline_access`, so Auth0 issues a refresh token
 *   (AC5).
 */
export function buildAuth0Config(
  config: Config,
): Omit<Auth0ProviderWithConfigOptions, "children"> {
  return {
    domain: config.VITE_AUTH0_DOMAIN,
    clientId: config.VITE_AUTH0_CLIENT_ID,
    authorizationParams: {
      audience: config.VITE_AUTH0_AUDIENCE,
      redirect_uri: authRedirectUri(),
      scope: "openid profile email offline_access",
    },
    cacheLocation: "memory",
    useRefreshTokens: true,
    useRefreshTokensFallback: false,
    workerUrl: AUTH0_WORKER_URL,
  };
}

/**
 * Placeholder redirect handler. Step 5 replaces this with the router's
 * `navigate` (AC6 / AC13); until then it swaps the URL in place so the
 * `code` / `state` query params are dropped after the exchange.
 */
export function defaultOnRedirectCallback(appState?: AppState): void {
  const returnTo =
    typeof appState?.returnTo === "string" ? appState.returnTo : "/app";
  window.history.replaceState(window.history.state, "", returnTo);
}

export interface Auth0ProviderWithNavigateProps {
  children: ReactNode;
  onRedirectCallback?: (appState?: AppState) => void;
}

/**
 * App-root Auth0 provider (Spec 04.0 §6.3, §3 "Provides"). Memory-only token
 * cache, refresh-token rotation with no iframe fallback, self-hosted worker.
 */
export function Auth0ProviderWithNavigate({
  children,
  onRedirectCallback = defaultOnRedirectCallback,
}: Auth0ProviderWithNavigateProps) {
  const options = buildAuth0Config(getConfig());
  return (
    <Auth0Provider {...options} onRedirectCallback={onRedirectCallback}>
      {children}
    </Auth0Provider>
  );
}
