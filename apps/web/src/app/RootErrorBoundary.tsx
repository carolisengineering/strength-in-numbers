import { Component, useEffect, useRef, type ReactNode } from "react";
import { useRouteError } from "react-router";

import { reportError } from "../observability/reportError";
import { Button } from "../ui/Button";
import { Screen } from "../ui/Screen";
import styles from "./RootErrorBoundary.module.css";

/**
 * Error boundaries (Spec 04.1 §6.4, AC8).
 *
 * React Router's data routers (`createBrowserRouter`) catch a render error
 * thrown inside a route element *themselves* — the nearest route's
 * `errorElement`, else the router's built-in "Unexpected Application Error!"
 * page. A class boundary wrapped around `<RouterProvider>` therefore never
 * sees route errors. So there are two pieces:
 *
 *   - `RootErrorBoundary` — the route-level fallback, registered as the root
 *     route's `errorElement` so it covers every route below it.
 *   - `AppErrorBoundary`  — a class boundary around `<RouterProvider>` for
 *     errors thrown *outside* the router (provider setup).
 *
 * Both render the same recoverable fallback and call `reportError()` exactly
 * once per error. Neither catches async errors in event handlers or queries —
 * those surface as `ApiError` and are handled in-screen.
 */

function reload(): void {
  window.location.reload();
}

/** The shared fallback: not a blank page, one way out. */
function BrokenScreen() {
  return (
    <Screen title="Something broke">
      <p data-testid="error-fallback">
        The app hit an error it could not recover from. Reloading usually fixes
        it; nothing you saved is lost.
      </p>
      <p className={styles.detail}>
        If it keeps happening, let us know what you were doing.
      </p>
      <Button block onClick={reload}>
        Reload
      </Button>
    </Screen>
  );
}

/**
 * Route-level fallback (`errorElement` on the root route). `useRouteError()`
 * hands over whatever the route threw; the effect is keyed on that object so
 * a re-render of the fallback does not report the same error twice.
 */
export function RootErrorBoundary() {
  const error = useRouteError();
  // StrictMode (dev) runs effects twice for the same render; the ref makes the
  // report idempotent per error object, keeping "exactly once" true there too.
  const reported = useRef<unknown>(undefined);

  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;
    reportError(error, { boundary: "root" });
  }, [error]);

  return <BrokenScreen />;
}

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Class boundary for errors thrown outside the router. A class because
 * `getDerivedStateFromError` / `componentDidCatch` have no hook equivalent —
 * this is the one class component in `apps/web`.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    // React calls this once per caught error; the `hasError` state keeps the
    // fallback mounted so a re-render cannot re-throw and re-report.
    reportError(error, { boundary: "app" });
  }

  override render(): ReactNode {
    return this.state.hasError ? <BrokenScreen /> : this.props.children;
  }
}
