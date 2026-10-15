import { useAuth0 } from "@auth0/auth0-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { logoutAndClear } from "../../auth/logout";
import { Button } from "../../ui/Button";
import { formatEraseDate } from "./formatEraseDate";
import { MESSAGES } from "./messages";
import styles from "./AccountDeletedConfirmation.module.css";
import type { AccountDeletion } from "./useDeleteAccount";

/**
 * Spec 12 §5.3 / AC20-AC22 — rendered by `ProtectedLayout` INSTEAD of the app once the delete is
 * accepted. On mount it cancels and removes cached queries (never `clear()`: that empties the mutation
 * cache and would revert the gate). It signs out through `useAuth0().logout` + `logoutAndClear`, NOT
 * `useSession()`: that hook starts a `useMe` observer, which after `removeQueries()` would fetch
 * `/v1/me` and get a 403.
 */
export function AccountDeletedConfirmation({ deletion }: { deletion: AccountDeletion }) {
  const { logout } = useAuth0();
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void queryClient.cancelQueries();
    queryClient.removeQueries();
    heading.current?.focus();
  }, [queryClient]);

  return (
    <main className={styles.screen} data-testid="account-deletion-confirmation">
      <h1 className={styles.title} ref={heading} tabIndex={-1}>
        {MESSAGES.deletedTitle}
      </h1>
      <p>{MESSAGES.deletedLocked(formatEraseDate(deletion.response.purgeEligibleAt, deletion.timeZone))}</p>
      <p>{MESSAGES.deletedRestore}</p>
      <Button block onClick={() => logoutAndClear(logout)}>
        {MESSAGES.signOut}
      </Button>
    </main>
  );
}
