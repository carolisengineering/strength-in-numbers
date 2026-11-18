import { createBrowserRouter, Navigate, type RouteObject } from "react-router";

import { Callback } from "../auth/Callback";
import { HistoryIndex, HistoryPanes, HistoryWorkout, HistoryWorkoutEdit } from "../features/history/HistoryPanes";
import { HevyRoute } from "../features/hevy/HevyRoute";
import { HevyScreen } from "../features/hevy/HevyScreen";
import { HevyImportRoute } from "../features/hevy/import/HevyImportRoute";
import { PairingsScreen } from "../features/hevy/pairings/PairingsScreen";
import { ProfileScreen } from "../features/me/ProfileScreen";
import { ExerciseRoute } from "../features/exercises/ExerciseScreen";
import { ExercisesIndex } from "../features/exercises/ExercisesIndex";
import { ExercisesLayout } from "../features/exercises/ExercisesLayout";
import { RECORDS_PATH } from "../features/exercises/paths";
import { RedirectProgressExercise } from "../features/exercises/redirects";
import { ImportEditRoute } from "../features/routines/import/ImportEdit";
import { ImportNames } from "../features/routines/import/ImportNames";
import { ImportPaste } from "../features/routines/import/ImportPaste";
import { ImportLayout } from "../features/routines/import/ImportSession";
import { RoutineEditorRoute } from "../features/routines/RoutineEditor";
import { RoutinePreviewRoute } from "../features/routines/RoutinePreview";
import { RoutinesPanes, WorkoutsIndex } from "../features/routines/RoutinesPanes";
import { EditWorkoutScreen } from "../features/workouts/edit/EditWorkoutScreen";
import { FinishedWorkoutScreen } from "../features/workouts/FinishedWorkoutScreen";
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
 *   /app/profile/hevy                                                 > HevyRoute (status gate) > HevyScreen (Spec 20.0, owner-only)
 *   /app/profile/hevy/pairings                                        > HevyRoute > PairingsScreen (Spec 20.0 Phase B)
 *   /app/profile/hevy/import                                          > HevyRoute > HevyImportRoute (Spec 20.1)
 *   /app/workouts                                                     > RoutinesPanes > WorkoutsIndex: WorkoutsScreen (Spec 06.1: active session or Start), or at 64rem with no live workout "Choose a routine" beside Start (Spec 17.12)
 *   /app/workouts/:id                                                 > FinishedWorkoutScreen section="workouts" (Spec 06.1)
 *   /app/workouts/:id/edit                                            > EditWorkoutScreen section="workouts" (Spec 18.0)
 *   /app/workouts/routines                                            > redirect (replace) to /app/workouts (Spec 10.0)
 *   /app/workouts/routines/new                                        > RoutineEditor, create (Spec 10.0)
 *   /app/workouts/routines/import                                     > ImportLayout (session) > ImportPaste (Spec 10.4)
 *   /app/workouts/routines/import/names                               > ImportLayout > Check exercise names (Spec 10.4)
 *   /app/workouts/routines/import/edit                                > ImportLayout > the editor (Spec 10.4 Phase C)
 *   /app/workouts/routines/:id                                        > RoutinesPanes > RoutinePreview (Spec 10.0, 17.12)
 *   /app/workouts/routines/:id/edit                                   > RoutinesPanes > RoutineEditor, edit (Spec 10.0, 17.12)
 *   /app/history/:id                                                  > HistoryPanes > FinishedWorkoutScreen section="history" (Spec 08.0, 17.12)
 *   /app/history/:id/edit                                             > HistoryPanes > EditWorkoutScreen section="history" (Spec 18.0, 17.12)
 *   /app/history                                                      > HistoryPanes > HistoryIndex: HistoryScreen, or at 64rem the newest summary (Spec 08.0, 17.12)
 *   /app/exercises                                                    > ExercisesLayout > ExercisesIndex: All exercises, or at 64rem the most recent exercise (Spec 18.2, 17.12)
 *   /app/exercises/records                                            > ExercisesLayout > ExercisesIndex: Records, or at 64rem as above (Spec 18.2, 17.12; outranks :id)
 *   /app/exercises/:id                                                > ExercisesLayout > ExerciseScreen, keyed by id (Spec 18.2, 17.12)
 *   /app/progress                                                     > redirect (replace) to the Records view (Spec 18.2, permanent)
 *   /app/progress/:exerciseId                                         > redirect (replace) to the exercise page (Spec 18.2, permanent)
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
              // Spec 20.0 AC1: owner-only; anyone else gets NotFound from the gate.
              {
                path: "profile/hevy",
                element: (
                  <HevyRoute>
                    <HevyScreen />
                  </HevyRoute>
                ),
              },
              {
                path: "profile/hevy/pairings",
                element: (
                  <HevyRoute>
                    <PairingsScreen />
                  </HevyRoute>
                ),
              },
              // Spec 20.1 AC1: the one-time import, behind the same gate.
              {
                path: "profile/hevy/import",
                element: (
                  <HevyRoute>
                    <HevyImportRoute />
                  </HevyRoute>
                ),
              },
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
                  { path: "edit", element: <ImportEditRoute /> },
                ],
              },
              // Spec 17.12 AC25: a pathless group of exactly these three, so `workouts/:id`, `routines/new` and
              // `routines/import/*` stay single columns; the static segments above still outrank `:id`.
              {
                element: <RoutinesPanes />,
                children: [
                  { path: "workouts", element: <WorkoutsIndex /> },
                  { path: "workouts/routines/:id", element: <RoutinePreviewRoute /> },
                  { path: "workouts/routines/:id/edit", element: <RoutineEditorRoute mode="edit" /> },
                ],
              },
              {
                // Spec 17.12 Phase B: one layout route, so at desktop widths the list sits beside the open workout.
                path: "history",
                element: <HistoryPanes />,
                children: [
                  { index: true, element: <HistoryIndex /> },
                  { path: ":id", element: <HistoryWorkout /> },
                  { path: ":id/edit", element: <HistoryWorkoutEdit /> },
                ],
              },
              {
                // Spec 17.12 Phase C: one layout route, so at desktop widths the list sits beside the open exercise.
                path: "exercises",
                element: <ExercisesLayout />,
                children: [
                  { index: true, element: <ExercisesIndex view="all" /> },
                  { path: "records", element: <ExercisesIndex view="records" /> },
                  // Spec 17.12 AC20: a child; the phone still draws it without the list (Panes draws no list below 64rem).
                  { path: ":id", element: <ExerciseRoute /> },
                ],
              },
              // Spec 18.2 AC3: the old Progress paths redirect for good (bookmarks, a captured returnTo).
              { path: "progress", element: <Navigate to={RECORDS_PATH} replace /> },
              { path: "progress/:exerciseId", element: <RedirectProgressExercise /> },
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
