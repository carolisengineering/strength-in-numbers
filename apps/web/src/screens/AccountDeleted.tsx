import { useAuth0 } from "@auth0/auth0-react";
import { useEffect } from "react";

import { logoutAndClear } from "../auth/logout";
import { CONTACT_OWNER } from "../features/account/messages";

/**
 * Terminal screen for a `403 account-deleted` from `GET /v1/me` (Spec 04.0 §5,
 * AC10). Logs the user out on mount — the account is soft-deleted (Spec 11), so
 * every call would 403.
 */
export function AccountDeleted() {
  const { logout } = useAuth0();

  useEffect(() => {
    logoutAndClear(logout);
  }, [logout]);

  return (
    <main data-testid="account-deleted">
      <h1>This account has been closed</h1>
      <p>If you think this is a mistake, {CONTACT_OWNER}.</p>
    </main>
  );
}
