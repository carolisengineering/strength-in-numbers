/**
 * Shown on a public route while the session-resume bridge kicks off a login
 * redirect (Spec 04.0 §5 / §6.8, AC4). Transient, no interactive controls.
 * Unstyled; CSS-Modules tokens are Spec 04.1.
 */
export function ResumingSession() {
  return (
    <main data-testid="resuming-session" role="status" aria-live="polite">
      <p>Resuming your session…</p>
    </main>
  );
}
