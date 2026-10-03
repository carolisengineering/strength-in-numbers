import { ApiError } from "../api/problem";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { useMe } from "../features/me/useMe";
import { WorkoutClientProvider } from "../features/workouts/WorkoutClientProvider";
import { AccountDeleted } from "../screens/AccountDeleted";
import { RetryScreen } from "../screens/RetryScreen";
import { Spinner } from "../ui/Spinner";
import { AppShell } from "./AppShell";

/**
 * Protected layout route + the `me`-query half of the bootstrap gate
 * (Spec 04.0 §5 / §6.5). It only mounts under `<ProtectedRoute>` (so the user is
 * already authenticated and public routes never trigger `GET /v1/me`), and holds
 * the protected `<Outlet/>` closed until `GET /v1/me` resolves:
 *
 *   pending                              -> <Spinner/>
 *   403 account-deleted (ApiError)       -> <AccountDeleted/> (logs out on mount)
 *   503 auth-unavailable / network / any -> <RetryScreen/> ("Try again" refetches)
 *   200 (incl. `isNewUser: true`)        -> <AppShell/> (which renders the <Outlet/>)
 *                                           inside <CatalogProvider> and <WorkoutClientProvider>
 *
 * Spec 04.1 §5: the gate is unchanged; only the `200` branch now renders the
 * styled shell instead of a bare `<Outlet/>`. Spec 06.1 mounts the catalog and
 * workout-client providers around it.
 */
export function ProtectedLayout() {
  const query = useMe();

  if (query.isPending) {
    return <Spinner label="Loading your account…" />;
  }

  if (query.isError) {
    const { error } = query;
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.type === "account-deleted"
    ) {
      return <AccountDeleted />;
    }
    return (
      <RetryScreen
        onRetry={() => void query.refetch()}
        requestId={error instanceof ApiError ? error.requestId : undefined}
      />
    );
  }

  // Spec 06.1: both providers mount only once `GET /v1/me` is 200 — the catalog is per user, and the
  // workout client needs an authenticated API client.
  return (
    <CatalogProvider userId={query.data.id}>
      <WorkoutClientProvider userId={query.data.id}>
        <AppShell />
      </WorkoutClientProvider>
    </CatalogProvider>
  );
}
