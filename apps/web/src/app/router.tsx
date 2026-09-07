import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router";

import { Callback } from "../auth/Callback";
import { AuthedPlaceholder } from "./AuthedPlaceholder";
import { BootstrapGate } from "./BootstrapGate";
import { ProtectedLayout } from "./ProtectedLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { PublicEntry } from "./PublicEntry";

/**
 * Route config (Spec 04.0 §5). Exported so tests drive it with
 * `createMemoryRouter(routes, { initialEntries })`.
 *
 *   /            BootstrapGate > PublicEntry                              public — resume decision (§6.8)
 *   /callback    BootstrapGate > Callback                                 public — transient PKCE handler
 *   /app         BootstrapGate > ProtectedRoute > ProtectedLayout > AuthedPlaceholder   protected (index)
 *   /app/*       BootstrapGate > ProtectedRoute > ProtectedLayout > AuthedPlaceholder   protected (deep links)
 *   *            → <Navigate to="/app">                                   catch-all (see below)
 *
 * `ProtectedRoute` is the auth guard; `ProtectedLayout` is the layout route that
 * runs the `me`-query gate (§6.5) and, in Spec 04.1, wraps the `<Outlet/>` in
 * `<AppShell>`.
 */
export const routes: RouteObject[] = [
  {
    element: <BootstrapGate />,
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
              { index: true, element: <AuthedPlaceholder /> },
              // A real NotFound screen for unknown /app/* paths is deferred to
              // Spec 04.1 (§5 / §6). Until then any protected deep link renders
              // the placeholder so returnTo round-trips can be exercised (AC13).
              { path: "*", element: <AuthedPlaceholder /> },
            ],
          },
        ],
      },
      // deferred: a real top-level NotFound screen is Spec 04.1 (§6). Minimal
      // redirect for now — an unknown path lands an authed user on /app and an
      // unauth user on / (via ProtectedRoute).
      { path: "*", element: <Navigate to="/app" replace /> },
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
