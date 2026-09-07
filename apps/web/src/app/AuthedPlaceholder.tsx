import { useAuth0 } from "@auth0/auth0-react";

import { useMe } from "../features/me/useMe";

/**
 * The one authed view this spec ships (Spec 04.0 §5, AC9). Proves the protected
 * frame renders from `GET /v1/me`: shows the signed-in email and a "Log out"
 * control. `useMe()` here shares the `["me"]` key with `ProtectedLayout`, so it
 * is one request, already resolved by the time this mounts. `isNewUser` is not
 * gated on. Spec 04.1 replaces the whole protected layout with `<AppShell>`.
 */
export function AuthedPlaceholder() {
  const { logout } = useAuth0();
  const { data } = useMe();

  return (
    <main data-testid="authed-placeholder">
      <p>
        You are signed in as{" "}
        <span data-testid="authed-email">{data?.email}</span>.
      </p>
      <button
        type="button"
        onClick={() =>
          void logout({ logoutParams: { returnTo: window.location.origin } })
        }
      >
        Log out
      </button>
    </main>
  );
}
