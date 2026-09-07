export interface SpinnerProps {
  label?: string;
}

/**
 * Full-screen loading state (Spec 04.0 §5 `<Spinner/>`). Shown by
 * `BootstrapGate` while the Auth0 SDK initialises, by `ProtectedRoute` and
 * `Callback` while `isLoading`. Step 6 / Spec 04.1 style it.
 */
export function Spinner({ label = "Loading…" }: SpinnerProps) {
  return (
    <div data-testid="spinner" role="status" aria-live="polite">
      {label}
    </div>
  );
}
