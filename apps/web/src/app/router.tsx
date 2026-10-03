import { createBrowserRouter, Navigate, type RouteObject } from "react-router";

import { Callback } from "../auth/Callback";
import { ProfileScreen } from "../features/me/ProfileScreen";
import { FinishedWorkoutScreen } from "../features/workouts/FinishedWorkoutScreen";
import { WorkoutsScreen } from "../features/workouts/WorkoutsScreen";
import { ComingSoon } from "../screens/ComingSoon";
import { NotFound } from "../screens/NotFound";
import { BootstrapGate } from "./BootstrapGate";
import { ProtectedLayout } from "./ProtectedLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { PublicEntry } from "./PublicEntry";
import { RootErrorBoundary } from "./RootErrorBoundary";

/**
 * Route config (Spec 04.0 §5). Exported so tests drive it with
 * `createMemoryRouter(routes, { initialEntries })`.
 *
 *   /            BootstrapGate > PublicEntry                              public — resume decision (§6.8)
 *   /callback    BootstrapGate > Callback                                 public — transient PKCE handler
 *   /app         BootstrapGate > ProtectedRoute > ProtectedLayout[AppShell] > redirect (replace) to /app/workouts (Spec 06.1 D20)
 *   /app/profile …                                                    > ProfileScreen  protected (Spec 04.1 slice)
 *   /app/workouts                                                     > WorkoutsScreen protected (Spec 06.1: active session or Start)
 *   /app/workouts/:id                                                 > FinishedWorkoutScreen protected (Spec 06.1; reused by Spec 08)
 *   /app/history | progress                                           > ComingSoon     protected (Specs 08 / 10)
 *   /app/*       …                                                    > NotFound       protected catch-all
 *   *            NotFound                                                              public catch-all
 *
 * `ProtectedRoute` is the auth guard; `ProtectedLayout` is the layout route that
 * runs the `me`-query gate (§6.5) and, once `GET /v1/me` is `200`, renders
 * `<AppShell>` around the `<Outlet/>` (Spec 04.1 §5).
 */
export const routes: RouteObject[] = [
  {
    element: <BootstrapGate />,
    // Spec 04.1 §6.4 / AC8: the data router catches route render errors
    // itself, so the fallback must be registered here, on the root route,
    // rather than as a boundary wrapped around <RouterProvider>.
    errorElement: <RootErrorBoundary />,
    children: [
      { path: "/", element: <PublicEntry /> },
      { path: "/callback", element: <Callback /> },
      {
        path: "/app",
        element: <ProtectedRoute />,
        children: [
          {
            element: <ProtectedLayout />,
            children: [
              { index: true, element: <Navigate to="/app/workouts" replace /> },
              { path: "profile", element: <ProfileScreen /> },
              { path: "workouts", element: <WorkoutsScreen /> },
              { path: "workouts/:id", element: <FinishedWorkoutScreen /> },
              { path: "history", element: <ComingSoon /> },
              { path: "progress", element: <ComingSoon /> },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}

export interface NavigableRouter {
  navigate: (to: string) => unknown;
}

/**
 * The `onRedirectCallback` for `<Auth0ProviderWithNavigate>`. The provider sits
 * **outside** `<RouterProvider>` (Spec 04.0 §5), so it cannot use `useNavigate`;
 * it drives the created router object directly. `appState.returnTo` is the
 * pre-login path captured by `PublicEntry` / `ProtectedRoute` (AC13); default
 * `/app`. The target is a clean path with no `code` / `state` / `error` params.
 */
export function makeOnRedirectCallback(router: NavigableRouter) {
  return (appState?: { returnTo?: string }): void => {
    const to =
      typeof appState?.returnTo === "string" ? appState.returnTo : "/app";
    void router.navigate(to);
  };
}
