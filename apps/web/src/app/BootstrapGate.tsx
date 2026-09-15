import { useAuth0 } from "@auth0/auth0-react";
import { Outlet } from "react-router";

import { Spinner } from "../ui/Spinner";

/**
 * Root layout gate (Spec 04.0 §5). Step 1: hold the whole route tree behind a
 * full-screen spinner until the Auth0 SDK finishes initialising — no route
 * content renders and no redirect fires while `isLoading`.
 *
 * Step 6 adds step 3 of §6.5 here: once `isAuthenticated`, run the `me` query
 * and gate the protected frame on its result (AC9 / AC10, needs the
 * QueryClientProvider that is not wired yet).
 */
export function BootstrapGate() {
  const { isLoading } = useAuth0();

  if (isLoading) return <Spinner label="Starting…" />;
  return <Outlet />;
}
