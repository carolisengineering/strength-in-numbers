import { getConfig } from "../config";

/**
 * Session-resume hint (Spec 04.0 §6.8 / Q20, AC4). Pure — no React, no token;
 * reading `document.cookie` is explicitly in scope here (it is the only
 * credential-free signal the Auth0 SDK maintains for exactly this purpose).
 *
 * `@auth0/auth0-spa-js` writes a client-id-scoped cookie
 * `auth0.{clientId}.is.authenticated` with the string value `true` after a
 * successful login and clears it on logout (Track C spike —
 * `Auth0Client.utils.ts` `buildIsAuthenticatedCookieName`). It still *reads* a
 * legacy unscoped `auth0.is.authenticated` for backwards-compat but never
 * writes one fresh, so a new SPA app only ever has the scoped name — we accept
 * either.
 */

function cookieEquals(
  cookieString: string,
  name: string,
  value: string,
): boolean {
  const target = `${name}=${value}`;
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === target);
}

export function hasAuth0Session(
  clientId: string = getConfig().VITE_AUTH0_CLIENT_ID,
  cookieString: string = document.cookie,
): boolean {
  if (clientId.length === 0) return false;
  return (
    cookieEquals(cookieString, `auth0.${clientId}.is.authenticated`, "true") ||
    cookieEquals(cookieString, "auth0.is.authenticated", "true")
  );
}

/** Stable surface per Spec 04.0 §3: `authHint.hasAuth0Session()`. */
export const authHint = { hasAuth0Session };
