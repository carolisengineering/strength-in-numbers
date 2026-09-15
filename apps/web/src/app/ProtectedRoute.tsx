import { useAuth0 } from "@auth0/auth0-react";
import { Navigate, Outlet, useLocation } from "react-router";

import { Spinner } from "../ui/Spinner";

/**
 * Guard for `/app` and everything under it (Spec 04.0 §5 / §6.7, AC13).
 *
 * - `isLoading` → spinner (defensive; `BootstrapGate` normally holds the outlet
 *   closed until the SDK is ready).
 * - `!isAuthenticated` → redirect to `/` with the requested path captured in
 *   **router state** (`state.returnTo`), never a query param, so `PublicEntry`'s
 *   login redirect and `onRedirectCallback` can round-trip it back (AC13).
 */
export function ProtectedRoute() {
  const { isLoading, isAuthenticated } = useAuth0();
  const location = useLocation();

  if (isLoading) return <Spinner label="Starting…" />;

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to="/" replace state={{ returnTo }} />;
  }

  return <Outlet />;
}
