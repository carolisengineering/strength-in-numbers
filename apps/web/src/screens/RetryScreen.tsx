export interface RetryScreenProps {
  onRetry: () => void;
  /** The failing request id, shown for support correlation (Spec 04.0 §5 / §9). */
  requestId?: string;
}

/**
 * Retry screen for a `503 auth-unavailable` or a network failure from
 * `GET /v1/me` (Spec 04.0 §5, AC10). "Try again" re-runs the `me` query; it does
 * NOT log the user out (the session may still be good).
 */
export function RetryScreen({ onRetry, requestId }: RetryScreenProps) {
  return (
    <main data-testid="retry-screen">
      <h1>Couldn&apos;t reach the server</h1>
      <p>Check your connection and try again.</p>
      {requestId ? (
        <p data-testid="retry-request-id">Reference: {requestId}</p>
      ) : null}
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
