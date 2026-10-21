import { createBrowserRouter, Navigate, type RouteObject } from "react-router";

import { Callback } from "../auth/Callback";
import { HistoryScreen } from "../features/history/HistoryScreen";
import { ProfileScreen } from "../features/me/ProfileScreen";
import { ExerciseProgressRoute } from "../features/progress/ExerciseProgressScreen";
import { ProgressScreen } from "../features/progress/ProgressScreen";
import { ImportNames } from "../features/routines/import/ImportNames";
import { ImportPaste } from "../features/routines/import/ImportPaste";
import { ImportLayout } from "../features/routines/import/ImportSession";
import { IMPORT_PATH } from "../features/routines/paths";
import { RoutineEditorRoute } from "../features/routines/RoutineEditor";
import { RoutinePreviewRoute } from "../features/routines/RoutinePreview";
import { EditWorkoutScreen } from "../features/workouts/edit/EditWorkoutScreen";
import { FinishedWorkoutScreen } from "../features/workouts/FinishedWorkoutScreen";
import { WorkoutsScreen } from "../features/workouts/WorkoutsScreen";
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
 *   /app/workouts/:id                                                 > FinishedWorkoutScreen section="workouts" (Spec 06.1)
 *   /app/workouts/:id/edit                                            > EditWorkoutScreen section="workouts" (Spec 18.0)
 *   /app/workouts/routines                                            > redirect (replace) to /app/workouts (Spec 10.0)
 *   /app/workouts/routines/new                                        > RoutineEditor, create (Spec 10.0)
 *   /app/workouts/routines/import                                     > ImportLayout (session) > ImportPaste (Spec 10.4)
 *   /app/workouts/routines/import/names                               > ImportLayout > Check exercise names (Spec 10.4)
 *   /app/workouts/routines/import/edit                                > ImportLayout > the editor (Spec 10.4 Phase C)
 *   /app/workouts/routines/:id                                        > RoutinePreview (Spec 10.0)
 *   /app/workouts/routines/:id/edit                                   > RoutineEditor, edit (Spec 10.0)
 *   /app/history/:id                                                  > FinishedWorkoutScreen section="history" (Spec 08.0)
 *   /app/history/:id/edit                                             > EditWorkoutScreen section="history" (Spec 18.0)
 *   /app/history                                                      > HistoryScreen  protected (Spec 08.0)
 *   /app/progress                                                     > ProgressScreen protected (Spec 08.1)
 *   /app/progress/:exerciseId                                         > ExerciseProgressScreen (Spec 08.1)
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
              { path: "workouts/:id", element: <FinishedWorkoutScreen section="workouts" /> },
              { path: "workouts/:id/edit", element: <EditWorkoutScreen section="workouts" /> },
              // Spec 10.0 §6.1: the bare path would otherwise match `workouts/:id` with id "routines".
              { path: "workouts/routines", element: <Navigate to="/app/workouts" replace /> },
              { path: "workouts/routines/new", element: <RoutineEditorRoute mode="create" /> },
              // Spec 10.4 AC20: static segments outrank `workouts/routines/:id` (and `:id/edit`).
              {
                path: "workouts/routines/import",
                element: <ImportLayout />,
                children: [
                  { index: true, element: <ImportPaste /> },
                  { path: "names", element: <ImportNames /> },
                  { path: "edit", element: <Navigate to={IMPORT_PATH} replace /> },
                ],
              },
              { path: "workouts/routines/:id", element: <RoutinePreviewRoute /> },
              { path: "workouts/routines/:id/edit", element: <RoutineEditorRoute mode="edit" /> },
              { path: "history", element: <HistoryScreen /> },
              { path: "history/:id", element: <FinishedWorkoutScreen section="history" /> },
              { path: "history/:id/edit", element: <EditWorkoutScreen section="history" /> },
              { path: "progress", element: <ProgressScreen /> },
              { path: "progress/:exerciseId", element: <ExerciseProgressRoute /> },
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
