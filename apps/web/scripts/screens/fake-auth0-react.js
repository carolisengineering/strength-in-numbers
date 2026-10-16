// Fake @auth0/auth0-react for the screenshot harness (Spec 17.0 §6.10). No imports, so it resolves from
// anywhere. It is reachable ONLY through the alias in scripts/screens/vite.config.mjs: the app's own
// vite.config.ts and src/** never reference this directory (AC19), and `assert:build-output` fails if the
// marker below ever appears in a production build.
// Logged-out mode: the page sets `window.__SIN_FAKE_AUTH__ = false` (Playwright addInitScript).
// The marker sits in the fake user's id (used by every useAuth0 call), so tree-shaking cannot drop it.
const SCREENS_HARNESS_MARKER = "sin-screens-harness-fake-auth";
const user = {
  sub: `auth0|${SCREENS_HARNESS_MARKER}`,
  name: "Carol Lifter",
  nickname: "carol",
  email: "carol@example.com",
  email_verified: true,
  picture: "",
};

const noop = async () => {};
const getAccessTokenSilently = async () => "fake-token";
const getAccessTokenWithPopup = async () => "fake-token";
const getIdTokenClaims = async () => ({ __raw: "fake-id-token", ...user });
const loginWithRedirect = async () => {
  console.log("[fake-auth0] loginWithRedirect");
};
const loginWithPopup = noop;
const logout = (opts) => {
  console.log("[fake-auth0] logout", JSON.stringify(opts ?? {}));
};
const handleRedirectCallback = async () => ({ appState: {} });

const base = {
  isLoading: false,
  error: undefined,
  getAccessTokenSilently,
  getAccessTokenWithPopup,
  getIdTokenClaims,
  loginWithRedirect,
  loginWithPopup,
  logout,
  handleRedirectCallback,
  connectAccountWithRedirect: noop,
};
const authed = Object.freeze({ ...base, isAuthenticated: true, user });
const anon = Object.freeze({ ...base, isAuthenticated: false, user: undefined });

const current = () => (typeof window !== "undefined" && window.__SIN_FAKE_AUTH__ === false ? anon : authed);

export function useAuth0() {
  return current();
}

export function Auth0Provider(props) {
  return props.children;
}

export function withAuthenticationRequired(Component) {
  return Component;
}

export function withAuth0(Component) {
  return Component;
}

export const Auth0Context = null;
export class AuthenticationError extends Error {}
export class OAuthError extends Error {}
export class GenericError extends Error {}
export class TimeoutError extends Error {}
export class PopupTimeoutError extends Error {}
export class MfaRequiredError extends Error {}
export class MissingRefreshTokenError extends Error {}
export class InMemoryCache {}
export class LocalStorageCache {}
export class User {}
