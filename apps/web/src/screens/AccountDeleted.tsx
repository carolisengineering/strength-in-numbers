import { useAuth0 } from "@auth0/auth0-react";
import { useEffect } from "react";

/**
 * Terminal screen for a `403 account-deleted` from `GET /v1/me` (Spec 04.0 §5,
 * AC10). Logs the user out on mount — the token is valid but the account row is
 * gone, so there is nothing to return to.
 */
export function AccountDeleted() {
  const { logout } = useAuth0();

  useEffect(() => {
    void logout({ logoutParams: { returnTo: window.location.origin } });
  }, [logout]);

  return (
    <main data-testid="account-deleted">
      <h1>This account has been closed</h1>
      <p>If you think this is a mistake, contact support.</p>
    </main>
  );
}
