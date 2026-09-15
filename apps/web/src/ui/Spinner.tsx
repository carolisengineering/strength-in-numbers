import styles from "./Spinner.module.css";

export interface SpinnerProps {
  label?: string;
}

/**
 * Full-screen loading state (Spec 04.0 §5; styled + moved to `ui/` by Spec
 * 04.1 §6.1). Shown by `BootstrapGate` while the Auth0 SDK initialises, by
 * `ProtectedRoute` and `Callback` while `isLoading`, and by `ProtectedLayout`
 * while `GET /v1/me` is pending. The label is the accessible status text; the
 * ring is decorative.
 */
export function Spinner({ label = "Loading…" }: SpinnerProps) {
  return (
    <div
      className={styles.spinner}
      data-testid="spinner"
      role="status"
      aria-live="polite"
    >
      <div className={styles.ring} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
